import { TRPCError } from "@trpc/server";
import prisma from "@vango-panel/db";
import { env } from "@vango-panel/env/server";
import { decryptSecret, encryptSecret, nodeConfigYaml, randomToken, WingsError } from "@vango-panel/wings";
import { z } from "zod";

import { adminProcedure, router } from "../../index";
import { logActivity, uuidRe, wingsFor } from "../../lib/wings";

const idInput = z.object({ id: z.string().regex(uuidRe) });

const nodeFields = z.object({
  name: z.string().trim().min(1).max(64),
  url: z
    .url({ protocol: /^https?$/ })
    .transform((u) => u.replace(/\/+$/, "")),
  sftpHost: z.string().trim().min(1).max(253),
  sftpPort: z.number().int().min(1).max(65535).default(2022),
  memoryMib: z.number().int().min(0).default(0),
  diskMib: z.number().int().min(0).default(0),
});

function newCredentials() {
  const tokenId = randomToken(12);
  const token = randomToken(48);
  return { tokenId, token, tokenEncrypted: encryptSecret(token) };
}

async function uniqueName<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && e.code === "P2002") {
      throw new TRPCError({ code: "CONFLICT", message: "A node with that name already exists" });
    }
    throw e;
  }
}

export function parsePorts(spec: string, max = 1000): number[] {
  const out = new Set<number>();
  for (const part of spec.split(/[\s,]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid port or range: ${part}` });
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (from < 1 || to > 65535 || from > to)
      throw new TRPCError({ code: "BAD_REQUEST", message: `Port range out of bounds: ${part}` });
    for (let p = from; p <= to; p++) {
      out.add(p);
      if (out.size > max) throw new TRPCError({ code: "BAD_REQUEST", message: `At most ${max} ports at once` });
    }
  }
  if (!out.size) throw new TRPCError({ code: "BAD_REQUEST", message: "No ports given" });
  return [...out].sort((a, b) => a - b);
}

export const nodesRouter = router({
  list: adminProcedure.query(async () => {
    const nodes = await prisma.node.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { servers: true, allocations: true } } },
    });
    const usage = await prisma.server.groupBy({
      by: ["nodeId"],
      _sum: { memoryMib: true, diskMib: true },
    });
    return nodes.map((n) => {
      const u = usage.find((x) => x.nodeId === n.id);
      return {
        id: n.id,
        name: n.name,
        url: n.url,
        sftpHost: n.sftpHost,
        sftpPort: n.sftpPort,
        memoryMib: n.memoryMib,
        diskMib: n.diskMib,
        allocatedMemoryMib: u?._sum.memoryMib ?? 0,
        allocatedDiskMib: u?._sum.diskMib ?? 0,
        servers: n._count.servers,
        allocations: n._count.allocations,
      };
    });
  }),

  get: adminProcedure.input(idInput).query(async ({ input }) => {
    const n = await prisma.node.findUnique({
      where: { id: input.id },
      include: {
        allocations: {
          orderBy: [{ ip: "asc" }, { port: "asc" }],
          include: { server: { select: { id: true, name: true } } },
        },
        _count: { select: { servers: true } },
      },
    });
    if (!n) throw new TRPCError({ code: "NOT_FOUND", message: "Node not found" });
    const { tokenEncrypted: _secret, ...rest } = n;
    return rest;
  }),

  system: adminProcedure.input(idInput).query(async ({ input }) => {
    const n = await prisma.node.findUnique({ where: { id: input.id } });
    if (!n) throw new TRPCError({ code: "NOT_FOUND", message: "Node not found" });
    try {
      return { online: true as const, info: await wingsFor(n).system() };
    } catch (e) {
      if (e instanceof WingsError) return { online: false as const, error: e.message };
      throw e;
    }
  }),

  configuration: adminProcedure.input(idInput).query(async ({ input }) => {
    const n = await prisma.node.findUnique({ where: { id: input.id } });
    if (!n) throw new TRPCError({ code: "NOT_FOUND", message: "Node not found" });
    return { yaml: nodeConfigYaml(n, decryptSecret(n.tokenEncrypted), env.BETTER_AUTH_URL) };
  }),

  create: adminProcedure.input(nodeFields).mutation(async ({ ctx, input }) => {
    const { token: _t, ...creds } = newCredentials();
    const n = await uniqueName(() => prisma.node.create({ data: { ...input, ...creds } }));
    await logActivity({ userId: ctx.session.user.id, event: "admin:node.created", metadata: { node: n.id }, ip: ctx.ip });
    return { id: n.id };
  }),

  update: adminProcedure.input(idInput.extend(nodeFields.shape)).mutation(async ({ input }) => {
    const { id, ...data } = input;
    await uniqueName(() => prisma.node.update({ where: { id }, data }));
    return { ok: true };
  }),

  rotateToken: adminProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const { token: _t, ...creds } = newCredentials();
    await prisma.node.update({ where: { id: input.id }, data: creds });
    await logActivity({ userId: ctx.session.user.id, event: "admin:node.token_rotated", metadata: { node: input.id }, ip: ctx.ip });
    return { ok: true };
  }),

  delete: adminProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const count = await prisma.server.count({ where: { nodeId: input.id } });
    if (count) throw new TRPCError({ code: "CONFLICT", message: `Node still has ${count} server(s)` });
    await prisma.node.delete({ where: { id: input.id } });
    await logActivity({ userId: ctx.session.user.id, event: "admin:node.deleted", metadata: { node: input.id }, ip: ctx.ip });
    return { ok: true };
  }),

  addAllocations: adminProcedure
    .input(
      z.object({
        nodeId: z.string().regex(uuidRe),
        ip: z.union([z.ipv4(), z.ipv6()]),
        ports: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ input }) => {
      const ports = parsePorts(input.ports);
      const r = await prisma.allocation.createMany({
        data: ports.map((port) => ({ nodeId: input.nodeId, ip: input.ip, port })),
        skipDuplicates: true,
      });
      return { created: r.count, skipped: ports.length - r.count };
    }),

  deleteAllocation: adminProcedure.input(idInput).mutation(async ({ input }) => {
    const r = await prisma.allocation.deleteMany({ where: { id: input.id, serverId: null } });
    if (!r.count) throw new TRPCError({ code: "CONFLICT", message: "Allocation is in use or does not exist" });
    return { ok: true };
  }),
});
