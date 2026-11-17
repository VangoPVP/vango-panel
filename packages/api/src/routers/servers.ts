import { TRPCError } from "@trpc/server";
import { isAdminRole } from "@vango-panel/auth/roles";
import prisma, { type Prisma } from "@vango-panel/db";
import {
  connectAddress,
  hasPermission,
  isEggFeature,
  parseDockerImages,
  parseTemplateVariables,
  powerActionSchema,
  resourceUsageSchema,
  usesPanelRelay,
  WingsError,
} from "@vango-panel/wings";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import {
  callWings,
  loadAccessibleServer,
  logActivity,
  requirePermission,
  trySync,
  uuidRe,
  websocketPermissions,
  wingsFor,
} from "../lib/wings";
import { issueWebsocketToken } from "../lib/ws-tokens";
import { serverDatabasesRouter } from "./server-databases";
import { serverFilesRouter } from "./server-files";
import { serverStartupRouter } from "./server-startup";
import { serverUsersRouter } from "./server-users";

const idInput = z.object({ id: z.string().regex(uuidRe, "invalid server id") });

function parseUsage(json: Prisma.JsonValue | null) {
  const r = resourceUsageSchema.safeParse(json);
  return r.success ? r.data : null;
}

export const serversRouter = router({
  files: serverFilesRouter,
  startup: serverStartupRouter,
  databases: serverDatabasesRouter,
  users: serverUsersRouter,

  list: protectedProcedure
    .input(z.object({ scope: z.enum(["mine", "others"]).default("mine") }).default({ scope: "mine" }))
    .query(async ({ ctx, input }) => {
      const user = ctx.session.user;
      const mine: Prisma.ServerWhereInput = {
        OR: [{ ownerId: user.id }, { subusers: { some: { userId: user.id } } }],
      };
      if (input.scope === "others" && !isAdminRole(user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const servers = await prisma.server.findMany({
        where: input.scope === "others" ? { NOT: mine } : mine,
        orderBy: { name: "asc" },
        include: {
          node: { select: { id: true, name: true, sftpHost: true } },
          defaultAllocation: true,
          owner: { select: { id: true, name: true, email: true } },
        },
      });
      return servers.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        status: s.status,
        suspended: s.suspended,
        isOwner: s.ownerId === user.id,
        node: { id: s.node.id, name: s.node.name },
        address: s.defaultAllocation ? connectAddress(s.defaultAllocation, s.node) : null,
        limits: { memoryMib: s.memoryMib, diskMib: s.diskMib, cpuPercent: s.cpuPercent },
        lastState: s.lastState,
        lastUtilization: parseUsage(s.lastUtilization),
        lastReportAt: s.lastReportAt,
        owner: s.owner,
      }));
    }),

  get: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const { server: s, permissions } = await loadAccessibleServer(ctx.session.user, input.id);
    const vars = parseTemplateVariables(s.template.variables);
    const env = (s.environment ?? {}) as Record<string, unknown>;
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      status: s.status,
      suspended: s.suspended,
      isOwner: s.ownerId === ctx.session.user.id,
      permissions,
      node: { id: s.node.id, name: s.node.name },
      template: { id: s.template.id, name: s.template.name },
      image: s.image,
      features: s.template.features.filter(isEggFeature),
      imageChoices: parseDockerImages(s.template.dockerImages, s.template.image),
      allocations: s.allocations.map((a) => ({
        id: a.id,
        ip: a.ip,
        port: a.port,
        address: connectAddress(a, s.node),
        isDefault: a.id === s.defaultAllocationId,
      })),
      limits: {
        memoryMib: s.memoryMib,
        swapMib: s.swapMib,
        diskMib: s.diskMib,
        cpuPercent: s.cpuPercent,
        ioWeight: s.ioWeight,
        threads: s.threads,
      },
      variables: vars
        .filter((v) => v.userEditable)
        .map((v) => ({ ...v, value: env[v.key] == null ? v.default : String(env[v.key]) })),
      sftp: {
        host: s.node.sftpHost,
        port: s.node.sftpPort,
        username: `${(ctx.session.user as { username?: string | null }).username ?? "?"}.${s.id.slice(0, 8)}`,
        allowed: hasPermission(permissions, "file.sftp"),
        hasKeys: (await prisma.sshKey.count({ where: { userId: ctx.session.user.id } })) > 0,
      },
      databases: {
        limit: s.databaseLimit,
        count: await prisma.serverDatabase.count({ where: { serverId: s.id } }),
      },
      lastState: s.lastState,
      lastUtilization: parseUsage(s.lastUtilization),
    };
  }),

  resources: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const { server } = await loadAccessibleServer(ctx.session.user, input.id);
    try {
      const d = await wingsFor(server.node).server(server.id);
      return { online: true as const, state: d.state, isInstalling: d.is_installing, usage: d.utilization };
    } catch (e) {
      if (!(e instanceof WingsError)) throw e;
      return {
        online: false as const,
        error: e.message,
        state: server.lastState,
        isInstalling: server.status === "installing",
        usage: parseUsage(server.lastUtilization),
      };
    }
  }),

  power: protectedProcedure
    .input(idInput.extend({ action: powerActionSchema }))
    .mutation(async ({ ctx, input }) => {
      const { server, permissions } = await loadAccessibleServer(ctx.session.user, input.id);
      requirePermission(permissions, `control.${input.action}`);
      if (server.suspended) throw new TRPCError({ code: "FORBIDDEN", message: "Server is suspended" });
      if (server.status === "installing")
        throw new TRPCError({ code: "CONFLICT", message: "Server is still installing" });
      await callWings(() => wingsFor(server.node).power(server.id, input.action));
      await logActivity({
        serverId: server.id,
        userId: ctx.session.user.id,
        event: `server:power.${input.action}`,
        ip: ctx.ip,
      });
      return { ok: true };
    }),

  command: protectedProcedure
    .input(idInput.extend({ command: z.string().min(1).max(4096) }))
    .mutation(async ({ ctx, input }) => {
      const { server, permissions } = await loadAccessibleServer(ctx.session.user, input.id);
      requirePermission(permissions, "control.console");
      await callWings(() => wingsFor(server.node).commands(server.id, [input.command]));
      await logActivity({
        serverId: server.id,
        userId: ctx.session.user.id,
        event: "server:console.command",
        metadata: { command: input.command },
        ip: ctx.ip,
      });
      return { ok: true };
    }),

  websocket: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const { server, permissions } = await loadAccessibleServer(ctx.session.user, input.id);
    requirePermission(permissions, "websocket.connect");
    // Browser can't reach this node: the console goes through /api/relay/servers/:id/console.
    if (usesPanelRelay(server.node)) return { mode: "relay" as const };
    const client = wingsFor(server.node);
    const { token, expiresAt } = issueWebsocketToken({
      nodeToken: client.nodeToken,
      userId: ctx.session.user.id,
      serverId: server.id,
      permissions: websocketPermissions(ctx.session.user, permissions),
    });
    return { mode: "direct" as const, socket: client.websocketUrl(server.id), token, expiresAt };
  }),

  acceptEula: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const { server, permissions } = await loadAccessibleServer(ctx.session.user, input.id);
    requirePermission(permissions, "file.update");
    if (server.suspended) throw new TRPCError({ code: "FORBIDDEN", message: "Server is suspended" });
    if (server.status === "installing") throw new TRPCError({ code: "CONFLICT", message: "Server is still installing" });
    const wings = wingsFor(server.node);
    await callWings(() => wings.writeFile(server.id, "eula.txt", "eula=true\n"));
    await logActivity({ serverId: server.id, userId: ctx.session.user.id, event: "server:eula.accepted", ip: ctx.ip });
    if (!hasPermission(permissions, "control.start")) return { started: false };
    await callWings(() => wings.power(server.id, "start", 30));
    return { started: true };
  }),

  setDockerImage: protectedProcedure
    .input(idInput.extend({ image: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { server, permissions } = await loadAccessibleServer(ctx.session.user, input.id);
      requirePermission(permissions, "startup.docker-image");
      if (server.suspended) throw new TRPCError({ code: "FORBIDDEN", message: "Server is suspended" });
      const choices = Object.values(parseDockerImages(server.template.dockerImages, server.template.image));
      if (!choices.includes(input.image)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That image isn't offered by this server's template" });
      }
      const updated = await prisma.server.update({
        where: { id: server.id },
        data: { image: input.image },
        include: { node: true },
      });
      await logActivity({
        serverId: server.id,
        userId: ctx.session.user.id,
        event: "server:startup.image",
        metadata: { from: server.image, to: input.image },
        ip: ctx.ip,
      });
      return trySync(updated);
    }),

  activity: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const { server } = await loadAccessibleServer(ctx.session.user, input.id);
    return prisma.activity.findMany({
      where: { serverId: server.id },
      orderBy: { timestamp: "desc" },
      take: 50,
    });
  }),
});
