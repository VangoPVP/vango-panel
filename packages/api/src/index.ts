import { initTRPC, TRPCError } from "@trpc/server";
import { isAdminRole } from "@vango-panel/auth/roles";
import { needsTwoFactorSetup } from "@vango-panel/auth/two-factor";
import { env } from "@vango-panel/env/server";

import type { Context } from "./context";

export const t = initTRPC.context<Context>().create();

export const router = t.router;

export const publicProcedure = t.procedure;

export const TWO_FACTOR_SETUP_REQUIRED = "Set up two-factor authentication on your Account page first.";

export const protectedProcedure = t.procedure.use(({ ctx, next, path }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      cause: "No session",
    });
  }
  // Users the policy requires 2FA from can only use their account until it's set up.
  if (!path.startsWith("account.") && needsTwoFactorSetup(ctx.session.user, env.PANEL_REQUIRE_2FA)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: TWO_FACTOR_SETUP_REQUIRED });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isAdminRole(ctx.session.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});
