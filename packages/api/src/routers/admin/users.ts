import { TRPCError } from "@trpc/server";
import { ASSIGNABLE_ROLES } from "@vango-panel/auth/roles";
import { normalizeUsername, usernameError } from "@vango-panel/auth/username";
import prisma from "@vango-panel/db";
import { z } from "zod";

import { adminProcedure, router } from "../../index";
import { logActivity } from "../../lib/wings";

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
          createdAt: true,
          _count: { select: { ownedServers: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 100,
      });
      return users.map(({ _count, ...u }) => ({ ...u, servers: _count.ownedServers }));
    }),

  setUsername: adminProcedure
    .input(z.object({ userId: z.string().min(1), username: z.string().max(100) }))
    .mutation(async ({ ctx, input }) => {
      const err = usernameError(input.username);
      if (err) throw new TRPCError({ code: "BAD_REQUEST", message: err });
      const username = normalizeUsername(input.username);
      try {
        await prisma.user.update({
          where: { id: input.userId },
          data: { username, displayUsername: input.username.trim() },
        });
      } catch (e) {
        const code = typeof e === "object" && e && "code" in e ? e.code : null;
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

  setRole: adminProcedure
    .input(z.object({ userId: z.string().min(1), role: z.enum(ASSIGNABLE_ROLES) }))
    .mutation(async ({ ctx, input }) => {
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
});
