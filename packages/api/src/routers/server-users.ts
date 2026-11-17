import { TRPCError } from "@trpc/server";
import { normalizeUsername } from "@vango-panel/auth/username";
import prisma from "@vango-panel/db";
import { ASSIGNABLE_PERMISSIONS, grantablePermissions, hasPermission, permissionChangeError } from "@vango-panel/wings";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { loadAccessibleServer, logActivity, requirePermission, uuidRe, wingsFor } from "../lib/wings";
import { takeLiveJtis } from "../lib/ws-tokens";
import { closeRelaySessions } from "../relay";

const uuid = z.string().regex(uuidRe);
const serverInput = z.object({ id: uuid });
const permissionList = z
  .array(z.string().max(64))
  .max(64)
  .transform((p) => [...new Set(p)]);

type ServerWithNode = Awaited<ReturnType<typeof loadAccessibleServer>>["server"];

/**
 * Makes a permission change take effect now: revokes the user's websocket tokens on wings and ends
 * their relayed consoles. Their browser reconnects and gets a token with the new permissions (or
 * nothing, if removed). Best-effort: if the node is offline the tokens expire on their own.
 */
async function revokeLiveAccess(server: ServerWithNode, userId: string) {
  const jtis = takeLiveJtis(server.id, userId);
  closeRelaySessions(server.id, userId);
  try {
    await wingsFor(server.node).denyWebsocketTokens(server.id, jtis);
  } catch (e) {
    console.warn(`[subusers] couldn't revoke ${jtis.length} token(s) on node ${server.node.name}:`, e);
  }
}

async function findUser(login: string) {
  const v = login.trim();
  if (v.includes("@")) {
    return prisma.user.findFirst({ where: { email: { equals: v, mode: "insensitive" } } });
  }
  return prisma.user.findUnique({ where: { username: normalizeUsername(v) } });
}

export const serverUsersRouter = router({
  list: protectedProcedure.input(serverInput).query(async ({ ctx, input }) => {
    const { server, permissions } = await loadAccessibleServer(ctx.session.user, input.id);
    requirePermission(permissions, "user.read");
    const rows = await prisma.serverUser.findMany({
      where: { serverId: server.id },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, name: true, email: true, username: true, displayUsername: true } } },
    });
    return {
      me: ctx.session.user.id,
      grantable: grantablePermissions(permissions),
      total: ASSIGNABLE_PERMISSIONS.length,
      canCreate: hasPermission(permissions, "user.create"),
      canUpdate: hasPermission(permissions, "user.update"),
      canDelete: hasPermission(permissions, "user.delete"),
      subusers: rows.map((r) => ({
        userId: r.userId,
        name: r.user.name,
        email: r.user.email,
        username: r.user.displayUsername ?? r.user.username,
        permissions: r.permissions.filter((p) => (ASSIGNABLE_PERMISSIONS as string[]).includes(p)),
        createdAt: r.createdAt,
      })),
    };
  }),

  add: protectedProcedure
    .input(serverInput.extend({ login: z.string().trim().min(1).max(320), permissions: permissionList }))
    .mutation(async ({ ctx, input }) => {
      const { server, permissions } = await loadAccessibleServer(ctx.session.user, input.id);
      requirePermission(permissions, "user.create");
      const target = await findUser(input.login);
      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No account with that email or username. They need to sign up first.",
        });
      }
      if (target.id === ctx.session.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You can't add yourself" });
      if (target.id === server.ownerId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That's the server owner; they already have full access" });
      }
      const err = permissionChangeError(permissions, [], input.permissions);
      if (err) throw new TRPCError({ code: "FORBIDDEN", message: err });
      try {
        await prisma.serverUser.create({ data: { serverId: server.id, userId: target.id, permissions: input.permissions } });
      } catch (e) {
        if (typeof e === "object" && e && "code" in e && e.code === "P2002") {
          throw new TRPCError({ code: "CONFLICT", message: "That user already has access to this server" });
        }
        throw e;
      }
      await logActivity({
        serverId: server.id,
        userId: ctx.session.user.id,
        event: "server:subuser.created",
        metadata: { subuser: target.id, email: target.email, permissions: input.permissions },
        ip: ctx.ip,
      });
      return { ok: true };
    }),

  update: protectedProcedure
    .input(serverInput.extend({ userId: z.string().min(1).max(64), permissions: permissionList }))
    .mutation(async ({ ctx, input }) => {
      const { server, permissions } = await loadAccessibleServer(ctx.session.user, input.id);
      requirePermission(permissions, "user.update");
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can't change your own permissions" });
      }
      const row = await prisma.serverUser.findUnique({
        where: { serverId_userId: { serverId: server.id, userId: input.userId } },
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Subuser not found" });
      // Keep stored permissions the editor doesn't manage (e.g. backup.read).
      const unmanaged = row.permissions.filter((p) => !(ASSIGNABLE_PERMISSIONS as string[]).includes(p));
      const after = [...new Set([...input.permissions, ...unmanaged])];
      const err = permissionChangeError(permissions, row.permissions, after);
      if (err) throw new TRPCError({ code: "FORBIDDEN", message: err });
      await prisma.serverUser.update({
        where: { serverId_userId: { serverId: server.id, userId: input.userId } },
        data: { permissions: after },
      });
      await revokeLiveAccess(server, input.userId);
      await logActivity({
        serverId: server.id,
        userId: ctx.session.user.id,
        event: "server:subuser.updated",
        metadata: { subuser: input.userId, before: row.permissions, after },
        ip: ctx.ip,
      });
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(serverInput.extend({ userId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const { server, permissions } = await loadAccessibleServer(ctx.session.user, input.id);
      requirePermission(permissions, "user.delete");
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can't remove yourself" });
      }
      const r = await prisma.serverUser.deleteMany({ where: { serverId: server.id, userId: input.userId } });
      if (!r.count) throw new TRPCError({ code: "NOT_FOUND", message: "Subuser not found" });
      await revokeLiveAccess(server, input.userId);
      await logActivity({
        serverId: server.id,
        userId: ctx.session.user.id,
        event: "server:subuser.deleted",
        metadata: { subuser: input.userId },
        ip: ctx.ip,
      });
      return { ok: true };
    }),
});
