import { TRPCError } from "@trpc/server";
import prisma, { type Prisma } from "@vango-panel/db";
import {
  connectAddress,
  parseDockerImages,
  parseTemplateVariables,
  validateVariables,
  WingsError,
} from "@vango-panel/wings";
import { z } from "zod";

import { adminProcedure, router } from "../../index";
import { callWings, logActivity, toTrpcError, trySync, uuidRe, wingsFor } from "../../lib/wings";

const uuid = z.string().regex(uuidRe);
const idInput = z.object({ id: uuid });

const limits = z.object({
  memoryMib: z.number().int().min(0),
  swapMib: z.number().int().min(-1).default(0),
  diskMib: z.number().int().min(0),
  cpuPercent: z.number().int().min(0).default(0),
  ioWeight: z.number().int().min(10).max(1000).default(500),
  threads: z
    .string()
    .trim()
    .regex(/^\d+(-\d+)?(,\d+(-\d+)?)*$/, "cpuset like 0-1,3")
    .nullish()
    .or(z.literal("").transform(() => null)),
  oomDisabled: z.boolean().default(false),
});

const details = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().max(1000).default(""),
  ownerId: z.string().min(1),
  environment: z.record(z.string(), z.string()).default({}),
});

async function cleanEnvironment(templateId: string, env: Record<string, string>) {
  const t = await prisma.template.findUnique({ where: { id: templateId } });
  if (!t) throw new TRPCError({ code: "BAD_REQUEST", message: "Template not found" });
  const variables = parseTemplateVariables(t.variables);
  const keys = new Set(variables.map((v) => v.key));
  const environment = Object.fromEntries(Object.entries(env).filter(([k]) => keys.has(k)));
  const errors = validateVariables(variables, environment);
  if (Object.keys(errors).length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid variables: ${Object.values(errors).join(" ")}` });
  }
  return { template: t, environment };
}

async function requireUser(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!u) throw new TRPCError({ code: "BAD_REQUEST", message: "Owner not found" });
}

export const adminServersRouter = router({
  list: adminProcedure.query(async () => {
    const servers = await prisma.server.findMany({
      orderBy: { name: "asc" },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        node: { select: { id: true, name: true, sftpHost: true } },
        template: { select: { id: true, name: true } },
        defaultAllocation: true,
      },
    });
    return servers.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      suspended: s.suspended,
      owner: s.owner,
      node: { id: s.node.id, name: s.node.name },
      template: s.template,
      address: s.defaultAllocation ? connectAddress(s.defaultAllocation, s.node) : null,
      memoryMib: s.memoryMib,
      diskMib: s.diskMib,
      cpuPercent: s.cpuPercent,
      lastState: s.lastState,
    }));
  }),

  get: adminProcedure.input(idInput).query(async ({ input }) => {
    const s = await prisma.server.findUnique({
      where: { id: input.id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        node: { select: { id: true, name: true, sftpHost: true } },
        template: true,
        allocations: { orderBy: { port: "asc" } },
      },
    });
    if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
    return {
      ...s,
      node: { id: s.node.id, name: s.node.name },
      allocations: s.allocations.map((a) => ({ ...a, address: connectAddress(a, s.node) })),
      environment: (s.environment ?? {}) as Record<string, string>,
      template: {
        id: s.template.id,
        name: s.template.name,
        image: s.template.image,
        dockerImages: parseDockerImages(s.template.dockerImages, s.template.image),
        variables: parseTemplateVariables(s.template.variables),
      },
    };
  }),

  freeAllocations: adminProcedure.input(z.object({ nodeId: uuid })).query(({ input }) =>
    prisma.allocation.findMany({
      where: { nodeId: input.nodeId, serverId: null },
      orderBy: [{ ip: "asc" }, { port: "asc" }],
      select: { id: true, ip: true, port: true, ipAlias: true },
    }),
  ),

  create: adminProcedure
    .input(
      details.extend({
        nodeId: uuid,
        templateId: uuid,
        allocationId: uuid,
        image: z.string().trim().min(1).optional(),
        startup: z.string().min(1).optional(),
        limits,
        skipInstall: z.boolean().default(false),
        startOnCompletion: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireUser(input.ownerId);
      const { template, environment } = await cleanEnvironment(input.templateId, input.environment);
      const node = await prisma.node.findUnique({ where: { id: input.nodeId } });
      if (!node) throw new TRPCError({ code: "BAD_REQUEST", message: "Node not found" });

      const server = await prisma.$transaction(async (tx) => {
        const s = await tx.server.create({
          data: {
            name: input.name,
            description: input.description,
            ownerId: input.ownerId,
            nodeId: node.id,
            templateId: template.id,
            image: input.image ?? template.image,
            startup: input.startup ?? template.startup,
            environment,
            skipInstall: input.skipInstall,
            status: "installing",
            ...input.limits,
            threads: input.limits.threads ?? null,
          },
        });
        const claimed = await tx.allocation.updateMany({
          where: { id: input.allocationId, nodeId: node.id, serverId: null },
          data: { serverId: s.id },
        });
        if (claimed.count !== 1) {
          throw new TRPCError({ code: "CONFLICT", message: "Allocation is taken or not on this node" });
        }
        return tx.server.update({ where: { id: s.id }, data: { defaultAllocationId: input.allocationId } });
      });

      try {
        await wingsFor(node).createServer(server.id, input.startOnCompletion);
      } catch (e) {
        await prisma.server.delete({ where: { id: server.id } });
        throw toTrpcError(e);
      }
      await logActivity({
        serverId: server.id,
        userId: ctx.session.user.id,
        event: "admin:server.created",
        metadata: { node: node.id, template: template.id },
        ip: ctx.ip,
      });
      return { id: server.id };
    }),

  update: adminProcedure
    .input(
      details.extend({
        id: uuid,
        image: z.string().trim().min(1),
        startup: z.string().min(1),
        limits,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await prisma.server.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
      await requireUser(input.ownerId);
      const { environment } = await cleanEnvironment(existing.templateId, input.environment);
      const s = await prisma.server.update({
        where: { id: input.id },
        data: {
          name: input.name,
          description: input.description,
          ownerId: input.ownerId,
          image: input.image,
          startup: input.startup,
          environment: environment as Prisma.InputJsonValue,
          ...input.limits,
          threads: input.limits.threads ?? null,
        },
        include: { node: true },
      });
      await logActivity({ serverId: s.id, userId: ctx.session.user.id, event: "admin:server.updated", ip: ctx.ip });
      return trySync(s);
    }),

  setSuspended: adminProcedure.input(idInput.extend({ suspended: z.boolean() })).mutation(async ({ ctx, input }) => {
    const s = await prisma.server.update({
      where: { id: input.id },
      data: { suspended: input.suspended },
      include: { node: true },
    });
    await logActivity({
      serverId: s.id,
      userId: ctx.session.user.id,
      event: input.suspended ? "admin:server.suspended" : "admin:server.unsuspended",
      ip: ctx.ip,
    });
    return trySync(s);
  }),

  reinstall: adminProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const s = await prisma.server.findUnique({ where: { id: input.id }, include: { node: true } });
    if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
    if (s.status === "installing") throw new TRPCError({ code: "CONFLICT", message: "Already installing" });
    await prisma.server.update({ where: { id: s.id }, data: { status: "installing" } });
    try {
      await wingsFor(s.node).reinstall(s.id);
    } catch (e) {
      await prisma.server.update({ where: { id: s.id }, data: { status: s.status } });
      throw toTrpcError(e);
    }
    await logActivity({ serverId: s.id, userId: ctx.session.user.id, event: "admin:server.reinstall", ip: ctx.ip });
    return { ok: true };
  }),

  delete: adminProcedure.input(idInput.extend({ force: z.boolean().default(false) })).mutation(async ({ ctx, input }) => {
    const s = await prisma.server.findUnique({ where: { id: input.id }, include: { node: true } });
    if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
    let warning: string | undefined;
    try {
      await wingsFor(s.node).deleteServer(s.id);
    } catch (e) {
      if (e instanceof WingsError && e.status === 404) {
      } else if (input.force && e instanceof WingsError) {
        warning = `Node said: ${e.message}. Files may remain on the node.`;
      } else {
        throw toTrpcError(e);
      }
    }
    await prisma.server.delete({ where: { id: s.id } });
    await logActivity({
      serverId: s.id,
      userId: ctx.session.user.id,
      event: "admin:server.deleted",
      metadata: { name: s.name, force: input.force },
      ip: ctx.ip,
    });
    return { ok: true, warning };
  }),

  sync: adminProcedure.input(idInput).mutation(async ({ input }) => {
    const s = await prisma.server.findUnique({ where: { id: input.id }, include: { node: true } });
    if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
    await callWings(() => wingsFor(s.node).sync(s.id));
    return { ok: true };
  }),
});
