import { TRPCError } from "@trpc/server";
import prisma from "@vango-panel/db";
import { DATABASE_REMOTE_RE, encryptSecret } from "@vango-panel/wings";
import { z } from "zod";

import { adminProcedure, router } from "../../index";
import { testHost } from "../../lib/mysql";
import { logActivity, uuidRe } from "../../lib/wings";

const idInput = z.object({ id: z.string().regex(uuidRe) });
const hostname = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.:\-[\]]+$/, "Must be a hostname or IP address");

const hostFields = z.object({
  name: z.string().trim().min(1).max(64),
  host: hostname,
  port: z.number().int().min(1).max(65535).default(3306),
  username: z.string().trim().min(1).max(80),
  connectHost: z
    .union([z.literal(""), hostname])
    .nullish()
    .transform((v) => v || null),
  allowedRemote: z.string().trim().regex(DATABASE_REMOTE_RE, "e.g. % or 172.31.250.%").default("%"),
  nodeId: z
    .union([z.literal(""), z.string().regex(uuidRe)])
    .nullish()
    .transform((v) => v || null),
  maxDatabases: z.number().int().min(1).nullish(),
});

function uniqueName(e: unknown): never {
  if (typeof e === "object" && e && "code" in e && e.code === "P2002") {
    throw new TRPCError({ code: "CONFLICT", message: "A database host with that name already exists" });
  }
  throw e;
}

async function requireGrant(host: { host: string; port: number; username: string }, password: string) {
  const r = await testHost({ ...host, passwordEncrypted: "" }, password);
  if (!r.canGrant) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Connected (${r.version}) but this account can't create users. It needs ALL PRIVILEGES ON *.* WITH GRANT OPTION.`,
    });
  }
}

export const databaseHostsRouter = router({
  list: adminProcedure.query(async () => {
    const hosts = await prisma.databaseHost.findMany({
      orderBy: { name: "asc" },
      include: { node: { select: { id: true, name: true } }, _count: { select: { databases: true } } },
    });
    return hosts.map(({ passwordEncrypted: _secret, _count, ...h }) => ({ ...h, databases: _count.databases }));
  }),

  create: adminProcedure
    .input(hostFields.extend({ password: z.string().min(1).max(512) }))
    .mutation(async ({ ctx, input }) => {
      const { password, ...data } = input;
      await requireGrant(data, password);
      const h = await prisma.databaseHost
        .create({ data: { ...data, maxDatabases: data.maxDatabases ?? null, passwordEncrypted: encryptSecret(password) } })
        .catch(uniqueName);
      await logActivity({ userId: ctx.session.user.id, event: "admin:database-host.created", metadata: { host: h.id }, ip: ctx.ip });
      return { id: h.id };
    }),

  update: adminProcedure
    .input(idInput.extend(hostFields.shape).extend({ password: z.string().max(512).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { id, password, ...data } = input;
      if (password) await requireGrant(data, password);
      await prisma.databaseHost
        .update({
          where: { id },
          data: {
            ...data,
            maxDatabases: data.maxDatabases ?? null,
            ...(password ? { passwordEncrypted: encryptSecret(password) } : {}),
          },
        })
        .catch(uniqueName);
      await logActivity({ userId: ctx.session.user.id, event: "admin:database-host.updated", metadata: { host: id }, ip: ctx.ip });
      return { ok: true };
    }),

  test: adminProcedure.input(idInput).mutation(async ({ input }) => {
    const h = await prisma.databaseHost.findUnique({ where: { id: input.id } });
    if (!h) throw new TRPCError({ code: "NOT_FOUND", message: "Database host not found" });
    return testHost(h);
  }),

  delete: adminProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const count = await prisma.serverDatabase.count({ where: { hostId: input.id } });
    if (count) throw new TRPCError({ code: "CONFLICT", message: `Host still has ${count} database(s)` });
    await prisma.databaseHost.delete({ where: { id: input.id } });
    await logActivity({ userId: ctx.session.user.id, event: "admin:database-host.deleted", metadata: { host: input.id }, ip: ctx.ip });
    return { ok: true };
  }),
});
