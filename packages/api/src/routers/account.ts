import { TRPCError } from "@trpc/server";
import prisma from "@vango-panel/db";
import { parseSshPublicKey, sshFingerprint } from "@vango-panel/wings";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { logActivity } from "../lib/wings";

const MAX_KEYS = 25;

export const accountRouter = router({
  sshKeys: router({
    list: protectedProcedure.query(({ ctx }) =>
      prisma.sshKey.findMany({
        where: { userId: ctx.session.user.id },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, type: true, fingerprint: true, createdAt: true, lastUsedAt: true },
      }),
    ),

    add: protectedProcedure
      .input(z.object({ name: z.string().trim().min(1).max(64), publicKey: z.string().max(16384) }))
      .mutation(async ({ ctx, input }) => {
        const parsed = parseSshPublicKey(input.publicKey);
        if (!parsed.ok) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error });
        const userId = ctx.session.user.id;
        if ((await prisma.sshKey.count({ where: { userId } })) >= MAX_KEYS) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `You can have at most ${MAX_KEYS} keys` });
        }
        const fingerprint = await sshFingerprint(parsed.key.blob);
        try {
          const key = await prisma.sshKey.create({
            data: { userId, name: input.name, type: parsed.key.type, fingerprint, publicKey: parsed.key.normalized },
            select: { id: true, fingerprint: true },
          });
          await logActivity({ userId, event: "account:ssh-key.added", metadata: { name: input.name, fingerprint }, ip: ctx.ip });
          return key;
        } catch (e) {
          if (typeof e === "object" && e && "code" in e && e.code === "P2002") {
            throw new TRPCError({ code: "CONFLICT", message: "You've already added this key" });
          }
          throw e;
        }
      }),

    delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
      const key = await prisma.sshKey.findFirst({ where: { id: input.id, userId: ctx.session.user.id } });
      if (!key) throw new TRPCError({ code: "NOT_FOUND", message: "Key not found" });
      await prisma.sshKey.delete({ where: { id: key.id } });
      await logActivity({
        userId: ctx.session.user.id,
        event: "account:ssh-key.removed",
        metadata: { name: key.name, fingerprint: key.fingerprint },
        ip: ctx.ip,
      });
      return { ok: true };
    }),
  }),
});
