import { randomInt } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { auth } from "@vango-panel/auth";
import { ASSIGNABLE_ROLES, isAdminRole, isSuperAdmin } from "@vango-panel/auth/roles";
import { normalizeUsername, usernameError } from "@vango-panel/auth/username";
import prisma from "@vango-panel/db";
import { z } from "zod";

import { adminProcedure, router } from "../../index";
import { logActivity, uuidRe, wingsFor } from "../../lib/wings";
import { takeLiveJtisForUser } from "../../lib/ws-tokens";
import { closeRelaySessions } from "../../relay";

type Actor = { id: string; role?: string | null };

const userInput = z.object({ userId: z.string().min(1) });

/**
 * Why `actor` may not manage `target` from the admin pages, or null if they may. Admins manage
 * regular users; only the super admin manages other admins; nobody manages the super admin here.
 * Acting on yourself is decided per action (see `loadManageable`).
 */
function lockReason(actor: Actor, target: { id: string; role: string }): string | null {
  if (target.id === actor.id) return null;
  if (isSuperAdmin(target.role)) return "The super admin's account can't be changed here";
  if (isAdminRole(target.role) && !isSuperAdmin(actor.role)) return "Only the super admin can manage other admins";
  return null;
}

async function loadManageable(actor: Actor, userId: string, opts: { allowSelf: boolean }) {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, email: true, username: true, name: true },
  });
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  if (!opts.allowSelf && target.id === actor.id) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Manage your own account on your Account page" });
  }
  const reason = lockReason(actor, target);
  if (reason) throw new TRPCError({ code: "FORBIDDEN", message: reason });
  return target;
}

/**
 * Cuts the user off everywhere right now: sessions (and 2FA trusted devices when asked), relayed
 * consoles, and console tokens on the nodes. Node calls are best-effort; tokens expire on their own.
 */
async function revokeUserAccess(userId: string) {
  closeRelaySessions(null, userId);
  const live = takeLiveJtisForUser(userId);
  if (!live.size) return;
  const servers = await prisma.server.findMany({ where: { id: { in: [...live.keys()] } }, include: { node: true } });
  await Promise.allSettled(
    servers.map(async (s) => {
      const jtis = live.get(s.id) ?? [];
      try {
        await wingsFor(s.node).denyWebsocketTokens(s.id, jtis);
      } catch (e) {
        console.warn(`[admin users] couldn't revoke ${jtis.length} token(s) on node ${s.node.name}:`, e);
      }
    }),
  );
}

// No 0/O, 1/l/I: the admin reads this out or pastes it into a chat.
const PASSWORD_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TEMP_PASSWORD_LENGTH = 20;

function generateTempPassword(): string {
  let out = "";
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  return out;
}

function prismaCode(e: unknown): unknown {
  return typeof e === "object" && e && "code" in e ? e.code : null;
}

export const usersRouter = router({
  list: adminProcedure
    .input(z.object({ search: z.string().max(100).default("") }).default({ search: "" }))
    .query(async ({ input }) => {
      const users = await prisma.user.findMany({
        where: input.search
          ? {
              OR: [
                { email: { contains: input.search, mode: "insensitive" } },
                { name: { contains: input.search, mode: "insensitive" } },
                { username: { contains: input.search, mode: "insensitive" } },
              ],
            }
          : {},
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          role: true,
          twoFactorEnabled: true,
          createdAt: true,
          _count: { select: { ownedServers: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 100,
      });
      return users.map(({ _count, ...u }) => ({ ...u, servers: _count.ownedServers }));
    }),

  get: adminProcedure.input(userInput).query(async ({ ctx, input }) => {
    const u = await prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        displayUsername: true,
        role: true,
        twoFactorEnabled: true,
        createdAt: true,
        updatedAt: true,
        accounts: { where: { providerId: "credential" }, select: { id: true } },
        ownedServers: {
          select: { id: true, name: true, node: { select: { id: true, name: true } } },
          orderBy: { name: "asc" },
        },
        subuserOf: {
          select: {
            permissions: true,
            server: { select: { id: true, name: true, owner: { select: { id: true, email: true } } } },
          },
          orderBy: { createdAt: "asc" },
        },
        sshKeys: {
          select: { id: true, name: true, type: true, fingerprint: true, createdAt: true, lastUsedAt: true },
          orderBy: { createdAt: "asc" },
        },
        sessions: {
          where: { expiresAt: { gt: new Date() } },
          select: { id: true, createdAt: true, updatedAt: true, expiresAt: true, ipAddress: true, userAgent: true },
          orderBy: { updatedAt: "desc" },
        },
      },
    });
    if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    const activity = await prisma.activity.findMany({
      // What they did, plus admin actions taken on them.
      where: { OR: [{ userId: u.id }, { metadata: { path: ["user"], equals: u.id } }] },
      select: { id: true, event: true, serverId: true, userId: true, ip: true, timestamp: true },
      orderBy: { timestamp: "desc" },
      take: 25,
    });
    const { accounts, ...rest } = u;
    const self = u.id === ctx.session.user.id;
    return {
      ...rest,
      hasPassword: accounts.length > 0,
      activity,
      self,
      locked: lockReason(ctx.session.user, u),
    };
  }),

  update: adminProcedure
    .input(
      userInput.extend({
        name: z.string().trim().min(1, "Name is required").max(100),
        email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadManageable(ctx.session.user, input.userId, { allowSelf: true });
      try {
        await prisma.user.update({ where: { id: input.userId }, data: { name: input.name, email: input.email } });
      } catch (e) {
        if (prismaCode(e) === "P2002") throw new TRPCError({ code: "CONFLICT", message: "That email is already in use" });
        throw e;
      }
      await logActivity({
        userId: ctx.session.user.id,
        event: "admin:user.updated",
        metadata: { user: input.userId, name: input.name, email: input.email },
        ip: ctx.ip,
      });
      return { ok: true };
    }),

  setUsername: adminProcedure
    .input(z.object({ userId: z.string().min(1), username: z.string().max(100) }))
    .mutation(async ({ ctx, input }) => {
      const err = usernameError(input.username);
      if (err) throw new TRPCError({ code: "BAD_REQUEST", message: err });
      await loadManageable(ctx.session.user, input.userId, { allowSelf: true });
      const username = normalizeUsername(input.username);
      try {
        await prisma.user.update({
          where: { id: input.userId },
          data: { username, displayUsername: input.username.trim() },
        });
      } catch (e) {
        const code = prismaCode(e);
        if (code === "P2002") throw new TRPCError({ code: "CONFLICT", message: "That username is taken" });
        if (code === "P2025") throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        throw e;
      }
      await logActivity({
        userId: ctx.session.user.id,
        event: "admin:user.username_changed",
        metadata: { user: input.userId, username },
        ip: ctx.ip,
      });
      return { ok: true, username };
    }),

  /**
   * Sets a random password and returns it once for the admin to hand over. Signs the user out
   * everywhere. The password is never logged.
   */
  resetPassword: adminProcedure.input(userInput).mutation(async ({ ctx, input }) => {
    const target = await loadManageable(ctx.session.user, input.userId, { allowSelf: false });
    const password = generateTempPassword();
    const hash = await (await auth.$context).password.hash(password);
    await prisma.$transaction(async (tx) => {
      const account = await tx.account.findFirst({
        where: { userId: target.id, providerId: "credential" },
        select: { id: true },
      });
      if (account) {
        await tx.account.update({ where: { id: account.id }, data: { password: hash } });
      } else {
        await tx.account.create({
          data: {
            id: crypto.randomUUID(),
            userId: target.id,
            accountId: target.id,
            providerId: "credential",
            password: hash,
          },
        });
      }
      await tx.session.deleteMany({ where: { userId: target.id } });
    });
    await revokeUserAccess(target.id);
    await logActivity({
      userId: ctx.session.user.id,
      event: "admin:user.password_reset",
      metadata: { user: target.id },
      ip: ctx.ip,
    });
    return { password };
  }),

  revokeSessions: adminProcedure.input(userInput).mutation(async ({ ctx, input }) => {
    const target = await loadManageable(ctx.session.user, input.userId, { allowSelf: false });
    const r = await prisma.session.deleteMany({ where: { userId: target.id } });
    await revokeUserAccess(target.id);
    await logActivity({
      userId: ctx.session.user.id,
      event: "admin:user.sessions_revoked",
      metadata: { user: target.id, sessions: r.count },
      ip: ctx.ip,
    });
    return { sessions: r.count };
  }),

  deleteSshKey: adminProcedure
    .input(userInput.extend({ keyId: z.string().regex(uuidRe) }))
    .mutation(async ({ ctx, input }) => {
      await loadManageable(ctx.session.user, input.userId, { allowSelf: true });
      const key = await prisma.sshKey.findFirst({ where: { id: input.keyId, userId: input.userId } });
      if (!key) throw new TRPCError({ code: "NOT_FOUND", message: "SSH key not found" });
      await prisma.sshKey.delete({ where: { id: key.id } });
      await logActivity({
        userId: ctx.session.user.id,
        event: "admin:user.ssh_key_deleted",
        metadata: { user: input.userId, fingerprint: key.fingerprint, name: key.name },
        ip: ctx.ip,
      });
      return { ok: true };
    }),

  /**
   * For users who lost their authenticator and backup codes: removes their 2FA, trusted devices and
   * every session. If policy requires 2FA from them, they must set it up again on next sign-in.
   */
  resetTwoFactor: adminProcedure.input(userInput).mutation(async ({ ctx, input }) => {
    if (input.userId === ctx.session.user.id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Manage your own 2FA on your Account page" });
    }
    await loadManageable(ctx.session.user, input.userId, { allowSelf: false });
    await prisma.$transaction([
      prisma.twoFactor.deleteMany({ where: { userId: input.userId } }),
      prisma.user.update({ where: { id: input.userId }, data: { twoFactorEnabled: false } }),
      prisma.verification.deleteMany({ where: { identifier: { startsWith: "trust-device-" }, value: input.userId } }),
      prisma.session.deleteMany({ where: { userId: input.userId } }),
    ]);
    await revokeUserAccess(input.userId);
    await logActivity({
      userId: ctx.session.user.id,
      event: "admin:user.2fa_reset",
      metadata: { user: input.userId },
      ip: ctx.ip,
    });
    return { ok: true };
  }),

  setRole: adminProcedure
    .input(z.object({ userId: z.string().min(1), role: z.enum(ASSIGNABLE_ROLES) }))
    .mutation(async ({ ctx, input }) => {
      // Admins can promote users and step down themselves; only the super admin demotes other admins.
      await loadManageable(ctx.session.user, input.userId, { allowSelf: true });
      const r = await prisma.user.updateMany({
        where: { id: input.userId, role: { not: "superadmin" } },
        data: { role: input.role },
      });
      if (!r.count) {
        const exists = await prisma.user.count({ where: { id: input.userId } });
        throw exists
          ? new TRPCError({ code: "FORBIDDEN", message: "The super admin's role can't be changed" })
          : new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      await logActivity({
        userId: ctx.session.user.id,
        event: "admin:user.role_changed",
        metadata: { user: input.userId, role: input.role },
        ip: ctx.ip,
      });
      return { ok: true };
    }),

  /**
   * Deletes the account. Servers they own move to `transferTo` (required if they own any); nothing on
   * the nodes changes. Sessions, 2FA, SSH keys and subuser access go with the user.
   */
  delete: adminProcedure
    .input(userInput.extend({ transferTo: z.string().min(1).optional() }))
    .mutation(async ({ ctx, input }) => {
      const target = await loadManageable(ctx.session.user, input.userId, { allowSelf: false });
      const transferred = await prisma.$transaction(async (tx) => {
        const owned = await tx.server.findMany({ where: { ownerId: target.id }, select: { id: true } });
        if (owned.length) {
          if (!input.transferTo) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `They own ${owned.length} server(s). Choose who should own them.`,
            });
          }
          if (input.transferTo === target.id) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a different new owner" });
          }
          const newOwner = await tx.user.count({ where: { id: input.transferTo } });
          if (!newOwner) throw new TRPCError({ code: "NOT_FOUND", message: "New owner not found" });
          const ids = owned.map((s) => s.id);
          // The new owner gets full access; a leftover subuser row would be meaningless.
          await tx.serverUser.deleteMany({ where: { userId: input.transferTo, serverId: { in: ids } } });
          await tx.server.updateMany({ where: { id: { in: ids } }, data: { ownerId: input.transferTo } });
        }
        await tx.verification.deleteMany({ where: { identifier: { startsWith: "trust-device-" }, value: target.id } });
        await tx.user.delete({ where: { id: target.id } });
        return owned.map((s) => s.id);
      });
      await revokeUserAccess(target.id);
      for (const serverId of transferred) {
        await logActivity({
          serverId,
          userId: ctx.session.user.id,
          event: "admin:server.owner_transferred",
          metadata: { from: target.id, fromEmail: target.email, to: input.transferTo ?? null },
          ip: ctx.ip,
        });
      }
      await logActivity({
        userId: ctx.session.user.id,
        event: "admin:user.deleted",
        // The user row is gone; keep enough to tell who it was.
        metadata: {
          user: target.id,
          email: target.email,
          username: target.username,
          name: target.name,
          transferredServers: transferred.length,
          transferTo: input.transferTo ?? null,
        },
        ip: ctx.ip,
      });
      return { transferred: transferred.length };
    }),
});
