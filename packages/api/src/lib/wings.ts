import { TRPCError } from "@trpc/server";
import { isAdminRole } from "@vango-panel/auth/roles";
import prisma, { type Prisma } from "@vango-panel/db";
import { effectivePermissions, hasPermission, type NodeRef, WingsClient, WingsError } from "@vango-panel/wings";

export async function callWings<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toTrpcError(e);
  }
}

export function toTrpcError(e: unknown): TRPCError {
  if (e instanceof TRPCError) return e;
  if (!(e instanceof WingsError)) {
    return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unexpected error", cause: e });
  }
  if (e.unreachable) return new TRPCError({ code: "SERVICE_UNAVAILABLE", message: e.message, cause: e });
  switch (e.status) {
    case 400:
    case 422:
      return new TRPCError({ code: "BAD_REQUEST", message: e.message });
    case 401:
    case 403:
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "The node rejected the panel's credentials. Check token_id/token in its config.yml.",
      });
    case 404:
      return new TRPCError({ code: "NOT_FOUND", message: e.message });
    case 409:
      return new TRPCError({ code: "CONFLICT", message: e.message });
    case 413:
      return new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: e.message });
    case 415:
      return new TRPCError({ code: "UNSUPPORTED_MEDIA_TYPE", message: e.message });
    case 507:
      return new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: e.message || "Not enough disk space" });
    default:
      return new TRPCError({ code: "BAD_GATEWAY", message: `Node error: ${e.message}` });
  }
}

export function wingsFor(node: NodeRef) {
  return new WingsClient(node);
}

type SessionUser = { id: string; role?: string | null };

export async function loadAccessibleServer(user: SessionUser, serverId: string) {
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    include: {
      node: true,
      template: true,
      defaultAllocation: true,
      allocations: { orderBy: { port: "asc" } },
      subusers: { where: { userId: user.id } },
    },
  });
  const permissions = server
    ? effectivePermissions({
        userId: user.id,
        isAdmin: isAdminRole(user.role),
        ownerId: server.ownerId,
        subuserPermissions: server.subusers[0]?.permissions ?? null,
      })
    : null;
  if (!server || !permissions) throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
  return { server, permissions };
}

export function requirePermission(permissions: string[], perm: string) {
  if (!hasPermission(permissions, perm)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Missing permission: ${perm}` });
  }
}

export async function logActivity(entry: {
  serverId?: string | null;
  userId?: string | null;
  event: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
}) {
  try {
    await prisma.activity.create({
      data: {
        serverId: entry.serverId ?? null,
        userId: entry.userId ?? null,
        event: entry.event,
        metadata: entry.metadata ?? {},
        ip: entry.ip ?? null,
        source: "panel",
      },
    });
  } catch (e) {
    console.error("[activity] failed to log", entry.event, e);
  }
}

export async function trySync(server: { id: string; node: NodeRef }) {
  try {
    await wingsFor(server.node).sync(server.id);
    return { synced: true as const };
  } catch (e) {
    if (e instanceof WingsError && (e.unreachable || e.status === 404)) {
      return { synced: false as const, warning: e.message };
    }
    throw toTrpcError(e);
  }
}

export const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
