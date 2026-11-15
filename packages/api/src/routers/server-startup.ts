import { TRPCError } from "@trpc/server";
import { isAdminRole } from "@vango-panel/auth/roles";
import prisma, { type Prisma } from "@vango-panel/db";
import {
  hasPermission,
  parseDockerImages,
  parseTemplateVariables,
  renderedStartup,
  resolveEnvironment,
  validateVariables,
} from "@vango-panel/wings";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { loadAccessibleServer, logActivity, requirePermission, trySync, uuidRe } from "../lib/wings";

const idInput = z.object({ id: z.string().regex(uuidRe, "invalid server id") });

type User = { id: string; role?: string | null };

function abilities(user: User, ownerId: string, permissions: string[]) {
  const admin = isAdminRole(user.role);
  return {
    admin,
    canEditCommand: admin || user.id === ownerId,
    canEditVariables: hasPermission(permissions, "startup.update"),
    canChangeImage: hasPermission(permissions, "startup.docker-image"),
  };
}

export const serverStartupRouter = router({
  get: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const { server, permissions } = await loadAccessibleServer(ctx.session.user, input.id);
    requirePermission(permissions, "startup.read");
    const can = abilities(ctx.session.user, server.ownerId, permissions);
    const variables = parseTemplateVariables(server.template.variables);
    const env = resolveEnvironment(server);
    const visible = can.admin ? variables : variables.filter((v) => v.userEditable);
    const hidden = new Set(variables.filter((v) => !visible.includes(v)).map((v) => v.key));
    return {
      ...can,
      startup: server.startup,
      templateStartup: server.template.startup,
      rendered: renderedStartup(server, hidden),
      image: server.image,
      imageChoices: parseDockerImages(server.template.dockerImages, server.template.image),
      variables: visible.map((v) => ({
        key: v.key,
        name: v.name,
        description: v.description,
        default: v.default,
        rules: v.rules,
        value: env[v.key] ?? v.default,
        editable: can.canEditVariables && (can.admin || v.userEditable),
      })),
    };
  }),

  update: protectedProcedure
    .input(
      idInput.extend({
        environment: z.record(z.string(), z.string().max(4096)).optional(),
        startup: z.string().trim().min(1).max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { server, permissions } = await loadAccessibleServer(ctx.session.user, input.id);
      const can = abilities(ctx.session.user, server.ownerId, permissions);
      if (server.suspended && !can.admin) throw new TRPCError({ code: "FORBIDDEN", message: "Server is suspended" });
      const data: Prisma.ServerUpdateInput = {};

      if (input.environment && Object.keys(input.environment).length) {
        requirePermission(permissions, "startup.update");
        const variables = parseTemplateVariables(server.template.variables);
        const allowed = new Set(variables.filter((v) => can.admin || v.userEditable).map((v) => v.key));
        const denied = Object.keys(input.environment).filter((k) => !allowed.has(k));
        if (denied.length) {
          throw new TRPCError({ code: "FORBIDDEN", message: `You can't change: ${denied.join(", ")}` });
        }
        const current = (server.environment ?? {}) as Record<string, string>;
        const environment = { ...current, ...input.environment };
        const errors = validateVariables(variables, environment);
        if (Object.keys(errors).length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid variables: ${Object.values(errors).join(" ")}` });
        }
        data.environment = environment;
      }

      if (input.startup !== undefined && input.startup !== server.startup) {
        if (!can.canEditCommand) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner or an admin can change the startup command" });
        }
        data.startup = input.startup;
      }

      if (!Object.keys(data).length) return { synced: true as const, changed: false };
      const updated = await prisma.server.update({ where: { id: server.id }, data, include: { node: true } });
      await logActivity({
        serverId: server.id,
        userId: ctx.session.user.id,
        event: "server:startup.edit",
        metadata: {
          ...(data.environment ? { variables: Object.keys(input.environment ?? {}) } : {}),
          ...(data.startup ? { startup: { from: server.startup, to: input.startup } } : {}),
        },
        ip: ctx.ip,
      });
      return { ...(await trySync(updated)), changed: true };
    }),
});
