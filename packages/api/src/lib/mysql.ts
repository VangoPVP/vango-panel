import { TRPCError } from "@trpc/server";
import { DATABASE_REMOTE_RE, decryptSecret } from "@vango-panel/wings";
import mysql, { type Connection } from "mysql2/promise";

// Provisioning for per-server databases on a MariaDB/MySQL host. Each call opens a short-lived
// connection with the host's admin account. Identifiers are validated by the caller
// (@vango-panel/wings/databases) *and* escaped here; passwords are always bound parameters.

export type HostCredentials = { host: string; port: number; username: string; passwordEncrypted: string };
export type DatabaseSpec = { name: string; username: string; remote: string };

const IDENT_RE = /^[a-z0-9_]{1,64}$/;

function ident(name: string): string {
  if (!IDENT_RE.test(name)) throw new Error(`refusing unsafe identifier: ${name}`);
  return mysql.escapeId(name);
}

function account(username: string, remote: string): string {
  if (!IDENT_RE.test(username) || !DATABASE_REMOTE_RE.test(remote)) throw new Error("refusing unsafe account");
  return `${mysql.escape(username)}@${mysql.escape(remote)}`;
}

function toTrpc(e: unknown): TRPCError {
  if (e instanceof TRPCError) return e;
  const err = e as { code?: string; message?: string; sqlMessage?: string };
  const msg = err.sqlMessage ?? err.message ?? "unknown error";
  if (err.code && ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH", "ECONNRESET"].includes(err.code)) {
    return new TRPCError({ code: "SERVICE_UNAVAILABLE", message: `Database host unreachable: ${msg}`, cause: e });
  }
  if (err.code === "ER_ACCESS_DENIED_ERROR") {
    return new TRPCError({ code: "BAD_GATEWAY", message: "Database host rejected the panel's credentials", cause: e });
  }
  return new TRPCError({ code: "BAD_GATEWAY", message: `Database host error: ${msg}`, cause: e });
}

async function withConnection<T>(host: HostCredentials, fn: (c: Connection) => Promise<T>, password?: string): Promise<T> {
  let conn: Connection | undefined;
  try {
    conn = await mysql.createConnection({
      host: host.host,
      port: host.port,
      user: host.username,
      password: password ?? decryptSecret(host.passwordEncrypted),
      connectTimeout: 5000,
      multipleStatements: false,
    });
    return await fn(conn);
  } catch (e) {
    throw toTrpc(e);
  } finally {
    await conn?.end().catch(() => {});
  }
}

/** Checks the connection and that the account can create users and grant privileges. */
export async function testHost(host: HostCredentials, plainPassword?: string) {
  return withConnection(
    host,
    async (c) => {
      const [[row]] = (await c.query("SELECT VERSION() AS version")) as unknown as [[{ version: string }]];
      const [grants] = (await c.query("SHOW GRANTS FOR CURRENT_USER()")) as unknown as [Record<string, string>[]];
      const lines = grants.map((g) => Object.values(g)[0] ?? "");
      const canGrant = lines.some((l) => /WITH GRANT OPTION/i.test(l) && /ON \*\.\*/i.test(l));
      return { version: row?.version ?? "unknown", canGrant };
    },
    plainPassword,
  );
}

/** Creates database + user + grant. All-or-nothing: anything created is dropped again on failure. */
export async function createDatabase(host: HostCredentials, db: DatabaseSpec, password: string) {
  const name = ident(db.name);
  const user = account(db.username, db.remote);
  await withConnection(host, async (c) => {
    let createdDb = false;
    let createdUser = false;
    try {
      await c.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      createdDb = true;
      await c.query(`CREATE USER ${user} IDENTIFIED BY ?`, [password]);
      createdUser = true;
      await c.query(`GRANT ALL PRIVILEGES ON ${name}.* TO ${user}`);
    } catch (e) {
      if (createdUser) await c.query(`DROP USER IF EXISTS ${user}`).catch(() => {});
      if (createdDb) await c.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => {});
      throw e;
    }
  });
}

export async function rotatePassword(host: HostCredentials, db: DatabaseSpec, password: string) {
  const user = account(db.username, db.remote);
  await withConnection(host, (c) => c.query(`ALTER USER ${user} IDENTIFIED BY ?`, [password]));
}

/** Drops the user and the database. Missing ones are fine (idempotent). */
export async function dropDatabase(host: HostCredentials, db: DatabaseSpec) {
  const name = ident(db.name);
  const user = account(db.username, db.remote);
  await withConnection(host, async (c) => {
    await c.query(`DROP USER IF EXISTS ${user}`);
    await c.query(`DROP DATABASE IF EXISTS ${name}`);
  });
}
