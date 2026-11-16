import { TRPCError } from "@trpc/server";
import prisma from "@vango-panel/db";
import { env, panelOrigins } from "@vango-panel/env/server";
import {
  connectAddress,
  decryptSecret,
  encryptSecret,
  nodeConfigYaml,
  randomToken,
  WingsError,
} from "@vango-panel/wings";
import { z } from "zod";

import { adminProcedure, router } from "../../index";
import { syncNodeDependentHosts, syncWarning } from "../../lib/database-sync";
import { logActivity, trySync, uuidRe, wingsFor } from "../../lib/wings";

const idInput = z.object({ id: z.string().regex(uuidRe) });

const bindIp = z.union([z.ipv4(), z.ipv6()]);
// Hostname or IP shown to users instead of the bind IP. Empty string clears it.
const ipAlias = z
  .string()
  .trim()
  .max(253)
  .regex(/^[A-Za-z0-9.:\-[\]]*$/, "Alias must be a hostname or IP address")
  .transform((v) => v || null);

const nodeFields = z.object({
  name: z.string().trim().min(1).max(64),
  url: z
    .url({ protocol: /^https?$/ })
    .transform((u) => u.replace(/\/+$/, "")),
  // Optional browser-facing URL (e.g. a NetBird reverse-proxy service). Empty = same as `url`.
  publicUrl: z
    .union([z.literal(""), z.url({ protocol: /^https?$/ })])
    .nullish()
    .transform((u) => (u ? u.replace(/\/+$/, "") : null)),
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
        publicUrl: n.publicUrl,
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
    const { tokenEncrypted: _secret, allocations, ...rest } = n;
    return { ...rest, allocations: allocations.map((a) => ({ ...a, address: connectAddress(a, n) })) };
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
    return {
      yaml: nodeConfigYaml(n, decryptSecret(n.tokenEncrypted), {
        remote: env.PANEL_REMOTE_URL ?? env.BETTER_AUTH_URL,
        allowedOrigins: panelOrigins(),
      }),
    };
  }),

  create: adminProcedure.input(nodeFields).mutation(async ({ ctx, input }) => {
    const { token: _t, ...creds } = newCredentials();
    const n = await uniqueName(() => prisma.node.create({ data: { ...input, ...creds } }));
    await logActivity({ userId: ctx.session.user.id, event: "admin:node.created", metadata: { node: n.id }, ip: ctx.ip });
    // The new node's IP gets an account on every database (containers there connect from it).
    return { id: n.id, warning: syncWarning(await syncNodeDependentHosts()) };
  }),

  update: adminProcedure.input(idInput.extend(nodeFields.shape)).mutation(async ({ input }) => {
    const { id, ...data } = input;
    const before = await prisma.node.findUnique({ where: { id }, select: { sftpHost: true } });
    await uniqueName(() => prisma.node.update({ where: { id }, data }));
    // A changed public host changes which IP the node's containers connect to databases from.
    const warning = before?.sftpHost === data.sftpHost ? undefined : syncWarning(await syncNodeDependentHosts());
    return { ok: true, warning };
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
    return { ok: true, warning: syncWarning(await syncNodeDependentHosts()) };
  }),

  addAllocations: adminProcedure
    .input(
      z.object({
        nodeId: z.string().regex(uuidRe),
        ip: bindIp,
        ipAlias: ipAlias.optional(),
        ports: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ input }) => {
      const ports = parsePorts(input.ports);
      const r = await prisma.allocation.createMany({
        data: ports.map((port) => ({ nodeId: input.nodeId, ip: input.ip, ipAlias: input.ipAlias ?? null, port })),
        skipDuplicates: true,
      });
      return { created: r.count, skipped: ports.length - r.count };
    }),

  updateAllocation: adminProcedure
    .input(z.object({ id: z.string().regex(uuidRe), ip: bindIp.optional(), ipAlias: ipAlias.optional() }))
    .mutation(async ({ ctx, input }) => {
      const before = await prisma.allocation.findUnique({
        where: { id: input.id },
        include: { server: { select: { id: true, node: true } } },
      });
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Allocation not found" });
      try {
        await prisma.allocation.update({
          where: { id: input.id },
          data: { ip: input.ip, ipAlias: input.ipAlias },
        });
      } catch (e) {
        if (typeof e === "object" && e && "code" in e && e.code === "P2002") {
          throw new TRPCError({ code: "CONFLICT", message: `${input.ip}:${before.port} already exists on this node` });
        }
        throw e;
      }
      await logActivity({
        serverId: before.server?.id ?? null,
        userId: ctx.session.user.id,
        event: "admin:allocation.updated",
        metadata: { allocation: before.id, ip: input.ip ?? before.ip, ipAlias: input.ipAlias ?? before.ipAlias },
        ip: ctx.ip,
      });
      // The bind IP is part of the server's docker config; push it to wings. It applies on the next start.
      if (input.ip === undefined || input.ip === before.ip || !before.server) return { rebound: false as const };
      const sync = await trySync(before.server);
      return { rebound: true as const, ...sync };
    }),

  deleteAllocation: adminProcedure.input(idInput).mutation(async ({ input }) => {
    const r = await prisma.allocation.deleteMany({ where: { id: input.id, serverId: null } });
    if (!r.count) throw new TRPCError({ code: "CONFLICT", message: "Allocation is in use or does not exist" });
    return { ok: true };
  }),
});
