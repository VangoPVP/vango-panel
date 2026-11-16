import { TRPCError } from "@trpc/server";
import { DATABASE_REMOTE_RE, decryptSecret } from "@vango-panel/wings";
import mysql, { type Connection } from "mysql2/promise";

// Provisioning for per-server databases on a MariaDB/MySQL host. Each call opens a short-lived
// connection with the host's admin account. Identifiers are validated by the caller
// (@vango-panel/wings/databases) *and* escaped here; passwords are always bound parameters.
//
// A database user exists once per allowed source ('u…'@'172.31.250.%', 'u…'@'192.168.2.113', …),
// all with the same password and a grant on that one database. `reconcile` makes MariaDB match the
// wanted list exactly, so it doubles as create, password rotation and node add/remove sync.

export type HostCredentials = { host: string; port: number; username: string; passwordEncrypted: string };
export type DatabaseRef = { name: string; username: string };

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

/** Host parts that currently exist for this username, e.g. ["172.31.250.%", "192.168.2.113"]. */
async function existingSources(c: Connection, username: string): Promise<string[]> {
  if (!IDENT_RE.test(username)) throw new Error("refusing unsafe identifier");
  const [rows] = (await c.query("SELECT Host AS host FROM mysql.user WHERE User = ?", [username])) as unknown as [
    { host: string }[],
  ];
  return rows.map((r) => r.host);
}

/** Make `db.username`'s accounts match `sources` exactly, all with `password` and a grant on `db.name`. */
async function reconcile(c: Connection, db: DatabaseRef, sources: string[], password: string) {
  // Never "sync" to nothing: that would drop every account and lock all servers out.
  if (!sources.length) throw new Error("no allowed sources configured; refusing to remove all accounts");
  const name = ident(db.name);
  const wanted = new Set(sources.map((s) => s.toLowerCase()));
  const existing = await existingSources(c, db.username);
  const have = new Set(existing.map((s) => s.toLowerCase()));
  for (const source of sources) {
    const user = account(db.username, source);
    if (have.has(source.toLowerCase())) await c.query(`ALTER USER ${user} IDENTIFIED BY ?`, [password]);
    else await c.query(`CREATE USER ${user} IDENTIFIED BY ?`, [password]);
    await c.query(`GRANT ALL PRIVILEGES ON ${name}.* TO ${user}`);
  }
  for (const source of existing) {
    if (wanted.has(source.toLowerCase()) || !DATABASE_REMOTE_RE.test(source)) continue;
    await c.query(`DROP USER IF EXISTS ${account(db.username, source)}`);
  }
}

async function dropAll(c: Connection, db: DatabaseRef) {
  for (const source of await existingSources(c, db.username)) {
    if (DATABASE_REMOTE_RE.test(source)) await c.query(`DROP USER IF EXISTS ${account(db.username, source)}`);
  }
  await c.query(`DROP DATABASE IF EXISTS ${ident(db.name)}`);
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

/** Creates the database and one user per source. All-or-nothing: anything created is dropped on failure. */
export async function createDatabase(host: HostCredentials, db: DatabaseRef, sources: string[], password: string) {
  if (!sources.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The database host allows no sources" });
  const name = ident(db.name);
  await withConnection(host, async (c) => {
    if ((await existingSources(c, db.username)).length) throw new Error(`user ${db.username} already exists`);
    await c.query(`CREATE DATABASE ${name} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    try {
      await reconcile(c, db, sources, password);
    } catch (e) {
      await dropAll(c, db).catch(() => {});
      throw e;
    }
  });
}

/** Sets a new password on every account of this database (and fixes up missing/stale sources). */
export async function rotatePassword(host: HostCredentials, db: DatabaseRef, sources: string[], password: string) {
  await withConnection(host, (c) => reconcile(c, db, sources, password));
}

/** Drops every account of this database's user, then the database. Idempotent. */
export async function dropDatabase(host: HostCredentials, db: DatabaseRef) {
  await withConnection(host, (c) => dropAll(c, db));
}

export type SyncItem = DatabaseRef & { password: string };

/**
 * Reconciles many databases over one connection. A failing database doesn't stop the others;
 * failures are returned. Throws only if the host itself is unreachable.
 */
export async function syncDatabases(host: HostCredentials, items: SyncItem[], sources: string[]) {
  return withConnection(host, async (c) => {
    const failed: { name: string; error: string }[] = [];
    for (const item of items) {
      try {
        await reconcile(c, item, sources, item.password);
      } catch (e) {
        failed.push({ name: item.name, error: (e as { sqlMessage?: string; message?: string }).sqlMessage ?? String(e) });
      }
    }
    return { synced: items.length - failed.length, failed };
  });
}
