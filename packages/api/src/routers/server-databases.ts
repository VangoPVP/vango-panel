// randomInt is backed by the CSPRNG.
import { randomInt } from "node:crypto";

import { TRPCError } from "@trpc/server";
import prisma from "@vango-panel/db";
import {
  databaseNameFor,
  databaseSuffixError,
  databaseUsernameFor,
  decryptSecret,
  encryptSecret,
  hasPermission,
  jdbcUrl,
} from "@vango-panel/wings";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { createDatabase, dropDatabase, rotatePassword } from "../lib/mysql";
import { loadAccessibleServer, logActivity, requirePermission, uuidRe } from "../lib/wings";

const uuid = z.string().regex(uuidRe);
const serverInput = z.object({ id: uuid });
const dbInput = z.object({ id: uuid, databaseId: uuid });

const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const LOWER_ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomString(alphabet: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** 32 chars of [A-Za-z0-9] (~190 bits); no quoting surprises in config files or JDBC URLs. */
export function generateDatabasePassword(): string {
  return randomString(ALNUM, 32);
}

function generateUsernameRandom(): string {
  return randomString(LOWER_ALNUM, 8);
}

async function loadDatabase(serverId: string, databaseId: string) {
  const db = await prisma.serverDatabase.findFirst({ where: { id: databaseId, serverId }, include: { host: true } });
  if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Database not found" });
  return db;
}

export const serverDatabasesRouter = router({
  list: protectedProcedure.input(serverInput).query(async ({ ctx, input }) => {
    const { server, permissions } = await loadAccessibleServer(ctx.session.user, input.id);
    requirePermission(permissions, "database.read");
    const showPasswords = hasPermission(permissions, "database.view-password");
    const rows = await prisma.serverDatabase.findMany({
      where: { serverId: server.id },
      orderBy: { createdAt: "asc" },
      include: { host: true },
    });
    return {
      limit: server.databaseLimit,
      canCreate: hasPermission(permissions, "database.create"),
      canUpdate: hasPermission(permissions, "database.update"),
      canDelete: hasPermission(permissions, "database.delete"),
      canViewPasswords: showPasswords,
      databases: rows.map((d) => {
        const host = d.host.connectHost ?? d.host.host;
        return {
          id: d.id,
          name: d.name,
          username: d.username,
          host,
          port: d.host.port,
          remote: d.remote,
          jdbc: jdbcUrl({ host, port: d.host.port, name: d.name }),
          password: showPasswords ? decryptSecret(d.passwordEncrypted) : null,
          createdAt: d.createdAt,
        };
      }),
    };
  }),

  create: protectedProcedure
    .input(serverInput.extend({ name: z.string().max(64) }))
    .mutation(async ({ ctx, input }) => {
      const { server, permissions } = await loadAccessibleServer(ctx.session.user, input.id);
      requirePermission(permissions, "database.create");
      if (server.suspended) throw new TRPCError({ code: "FORBIDDEN", message: "Server is suspended" });
      const nameError = databaseSuffixError(input.name);
      if (nameError) throw new TRPCError({ code: "BAD_REQUEST", message: nameError });

      const count = await prisma.serverDatabase.count({ where: { serverId: server.id } });
      if (count >= server.databaseLimit) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: server.databaseLimit
            ? `This server can have at most ${server.databaseLimit} database(s)`
            : "Databases are not enabled for this server",
        });
      }

      const name = databaseNameFor(server.id, input.name);
      if (await prisma.serverDatabase.findFirst({ where: { serverId: server.id, name } })) {
        throw new TRPCError({ code: "CONFLICT", message: "A database with that name already exists" });
      }

      // Prefer hosts linked to this server's node, then the least used one.
      const hosts = await prisma.databaseHost.findMany({
        where: { OR: [{ nodeId: server.nodeId }, { nodeId: null }] },
        include: { _count: { select: { databases: true } } },
      });
      const host = hosts
        .filter((h) => h.maxDatabases == null || h._count.databases < h.maxDatabases)
        .sort((a, b) => Number(!a.nodeId) - Number(!b.nodeId) || a._count.databases - b._count.databases)[0];
      if (!host) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No database host is available for this server" });
      }

      const spec = { name, username: databaseUsernameFor(server.id, generateUsernameRandom()), remote: host.allowedRemote };
      const password = generateDatabasePassword();
      await createDatabase(host, spec, password);
      try {
        const row = await prisma.serverDatabase.create({
          data: { serverId: server.id, hostId: host.id, ...spec, passwordEncrypted: encryptSecret(password) },
        });
        await logActivity({
          serverId: server.id,
          userId: ctx.session.user.id,
          event: "server:database.created",
          metadata: { database: name, host: host.name },
          ip: ctx.ip,
        });
        return { id: row.id };
      } catch (e) {
        await dropDatabase(host, spec).catch(() => {});
        throw e;
      }
    }),

  rotatePassword: protectedProcedure.input(dbInput).mutation(async ({ ctx, input }) => {
    const { server, permissions } = await loadAccessibleServer(ctx.session.user, input.id);
    requirePermission(permissions, "database.update");
    const db = await loadDatabase(server.id, input.databaseId);
    const password = generateDatabasePassword();
    await rotatePassword(db.host, db, password);
    await prisma.serverDatabase.update({ where: { id: db.id }, data: { passwordEncrypted: encryptSecret(password) } });
    await logActivity({
      serverId: server.id,
      userId: ctx.session.user.id,
      event: "server:database.password-rotated",
      metadata: { database: db.name },
      ip: ctx.ip,
    });
    return { ok: true };
  }),

  delete: protectedProcedure.input(dbInput).mutation(async ({ ctx, input }) => {
    const { server, permissions } = await loadAccessibleServer(ctx.session.user, input.id);
    requirePermission(permissions, "database.delete");
    const db = await loadDatabase(server.id, input.databaseId);
    await dropDatabase(db.host, db);
    await prisma.serverDatabase.delete({ where: { id: db.id } });
    await logActivity({
      serverId: server.id,
      userId: ctx.session.user.id,
      event: "server:database.deleted",
      metadata: { database: db.name },
      ip: ctx.ip,
    });
    return { ok: true };
  }),
});
