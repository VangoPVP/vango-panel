import { isAdminRole } from "@vango-panel/auth/roles";
import prisma, { type Node, Prisma } from "@vango-panel/db";
import { z } from "zod";

import { buildInstallationScript, buildServerConfiguration, serverConfigInclude } from "./config";
import { decryptSecret, safeEqual } from "./crypto";
import { effectivePermissions, hasPermission } from "./permissions";
import {
  activityBatchSchema,
  installStatusSchema,
  serverEventReportSchema,
  stateReportBatchSchema,
} from "./protocol";
import { parseSftpUsername, parseSshPublicKey, sshFingerprint } from "./ssh";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class RemoteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

async function authenticateNode(req: Request): Promise<Node> {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+([^.\s]+)\.(\S+)$/.exec(header);
  if (!m) throw new RemoteError(401, "missing or malformed node credentials");
  const [, tokenId, token] = m as unknown as [string, string, string];
  const node = await prisma.node.findUnique({ where: { tokenId } });
  let expected = "\0invalid";
  if (node) {
    try {
      expected = decryptSecret(node.tokenEncrypted);
    } catch {
      throw new RemoteError(500, "node token cannot be decrypted (was PANEL_APP_KEY changed?)");
    }
  }
  if (!safeEqual(expected, token) || !node) throw new RemoteError(403, "invalid node credentials");
  return node;
}

async function body<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new RemoteError(400, "body must be JSON");
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new RemoteError(422, `invalid body: ${r.error.issues[0]?.message ?? "unknown"}`);
  return r.data as z.infer<S>;
}

async function ownServer(node: Node, uuid: string) {
  if (!UUID_RE.test(uuid)) throw new RemoteError(404, "server not found");
  const server = await prisma.server.findFirst({
    where: { id: uuid, nodeId: node.id },
    include: serverConfigInclude,
  });
  if (!server) throw new RemoteError(404, "server not found");
  return server;
}

function intParam(url: URL, name: string, def: number, min: number, max: number) {
  const n = Number.parseInt(url.searchParams.get(name) ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

async function listServers(node: Node, url: URL) {
  const perPage = intParam(url, "per_page", 50, 1, 500);
  const page = intParam(url, "page", 1, 1, 1_000_000);
  const [total, servers] = await prisma.$transaction([
    prisma.server.count({ where: { nodeId: node.id } }),
    prisma.server.findMany({
      where: { nodeId: node.id },
      include: serverConfigInclude,
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);
  return json({
    data: servers.map(buildServerConfiguration),
    meta: { current_page: page, last_page: Math.max(1, Math.ceil(total / perPage)), total },
  });
}

async function installStatus(node: Node, uuid: string, req: Request) {
  const server = await ownServer(node, uuid);
  const b = await body(req, installStatusSchema);
  await prisma.server.update({
    where: { id: server.id },
    data: b.successful
      ? { status: null, installedAt: server.installedAt ?? new Date() }
      : { status: b.reinstall ? "reinstall_failed" : "install_failed" },
  });
  await logDaemonActivity(server.id, b.successful ? "server:install.completed" : "server:install.failed", {
    reinstall: b.reinstall,
  });
  return noContent();
}

async function resetServers(node: Node) {
  await prisma.$transaction([
    prisma.server.updateMany({
      where: { nodeId: node.id, status: "installing" },
      data: { status: "install_failed" },
    }),
    prisma.server.updateMany({
      where: { nodeId: node.id, status: "restoring_backup" },
      data: { status: null },
    }),
  ]);
  return noContent();
}

async function reportStates(node: Node, req: Request) {
  const b = await body(req, stateReportBatchSchema);
  const now = new Date();
  const ids = b.data.map((s) => s.uuid).filter((id) => UUID_RE.test(id));
  const known = new Set(
    (await prisma.server.findMany({ where: { nodeId: node.id, id: { in: ids } }, select: { id: true } })).map(
      (s) => s.id,
    ),
  );
  const updates = b.data
    .filter((s) => known.has(s.uuid))
    .map((s) =>
      prisma.server.update({
        where: { id: s.uuid },
        data: {
          lastState: s.state,
          lastUtilization: (s.utilization ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          lastReportAt: now,
        },
      }),
    );
  if (updates.length) await prisma.$transaction(updates);
  return noContent();
}

async function serverEvent(node: Node, uuid: string, req: Request) {
  const server = await ownServer(node, uuid);
  const b = await body(req, serverEventReportSchema);
  await logDaemonActivity(
    server.id,
    `server:${b.event}`,
    { exit_code: b.exit_code ?? null, oom_killed: b.oom_killed, restarting: b.restarting },
    new Date(b.timestamp),
  );
  return noContent();
}

async function activity(node: Node, req: Request) {
  const b = await body(req, activityBatchSchema);
  const ids = b.data.map((a) => a.server).filter((id) => UUID_RE.test(id));
  const own = new Set(
    (await prisma.server.findMany({ where: { nodeId: node.id, id: { in: ids } }, select: { id: true } })).map(
      (s) => s.id,
    ),
  );
  const rows = b.data
    .filter((a) => own.has(a.server))
    .map((a) => ({
      serverId: a.server,
      userId: a.user ?? null,
      event: a.event,
      metadata: (a.metadata ?? {}) as Prisma.InputJsonValue,
      ip: a.ip ?? null,
      source: "daemon",
      timestamp: Number.isNaN(Date.parse(a.timestamp)) ? new Date() : new Date(a.timestamp),
    }));
  if (rows.length) await prisma.activity.createMany({ data: rows });
  return noContent();
}

const sftpAuthSchema = z.object({
  type: z.string(),
  username: z.string().max(200),
  password: z.string().max(16384),
  ip: z.string().max(100),
});

async function sftpAuth(node: Node, req: Request) {
  const b = await body(req, sftpAuthSchema);
  const deny = () => new RemoteError(403, "invalid credentials");
  const login = parseSftpUsername(b.username);
  if (!login) throw deny();

  const matches = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM server
    WHERE "nodeId" = ${node.id}::uuid AND id::text LIKE ${`${login.serverPrefix}%`}
    LIMIT 2`;
  const serverId = matches.length === 1 ? matches[0]?.id : undefined;
  if (!serverId) throw deny();

  const denied = async (reason: string, userId?: string) => {
    await prisma.activity.create({
      data: {
        serverId,
        userId: userId ?? null,
        event: "server:sftp.denied",
        metadata: { username: login.username, reason },
        ip: b.ip || null,
        source: "panel",
      },
    });
    return deny();
  };

  if (b.type !== "public_key") throw await denied("password login (SFTP is key-only)");
  const user = await prisma.user.findUnique({ where: { username: login.username } });
  if (!user) throw await denied("unknown username");

  const parsed = parseSshPublicKey(b.password);
  if (!parsed.ok) throw await denied("unreadable public key", user.id);
  const fingerprint = await sshFingerprint(parsed.key.blob);
  const key = await prisma.sshKey.findUnique({ where: { userId_fingerprint: { userId: user.id, fingerprint } } });
  if (!key) throw await denied(`unknown key ${fingerprint}`, user.id);

  const server = await prisma.server.findUnique({
    where: { id: serverId },
    include: { subusers: { where: { userId: user.id } } },
  });
  if (!server) throw deny();
  const permissions = effectivePermissions({
    userId: user.id,
    isAdmin: isAdminRole(user.role),
    ownerId: server.ownerId,
    subuserPermissions: server.subusers[0]?.permissions ?? null,
  });
  if (!permissions || !hasPermission(permissions, "file.sftp")) throw await denied("no SFTP access to this server", user.id);
  if (server.suspended) throw await denied("server is suspended", user.id);
  if (server.status === "installing") throw await denied("server is installing", user.id);

  await prisma.sshKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  await prisma.activity.create({
    data: {
      serverId,
      userId: user.id,
      event: "server:sftp.login",
      metadata: { key: key.name, fingerprint },
      ip: b.ip || null,
      source: "panel",
    },
  });
  return json({
    server: server.id,
    user: user.id,
    permissions: permissions.includes("*") ? ["*"] : permissions.filter((p) => p.startsWith("file.")),
  });
}

async function logDaemonActivity(serverId: string, event: string, metadata: Prisma.InputJsonValue, at?: Date) {
  await prisma.activity.create({
    data: { serverId, event, metadata, source: "daemon", ...(at && !Number.isNaN(at.getTime()) ? { timestamp: at } : {}) },
  });
}

async function route(req: Request, node: Node, segments: string[]): Promise<Response> {
  const method = req.method.toUpperCase();
  const url = new URL(req.url);
  const [a, b, c, d] = segments;

  if (a === "servers") {
    if (segments.length === 1 && method === "GET") return listServers(node, url);
    if (segments.length === 2 && b === "reset" && method === "POST") return resetServers(node);
    if (segments.length === 2 && b === "states" && method === "POST") return reportStates(node, req);
    if (b && segments.length === 2 && method === "GET")
      return json(buildServerConfiguration(await ownServer(node, b)));
    if (b && c === "install" && segments.length === 3) {
      if (method === "GET") return json(buildInstallationScript((await ownServer(node, b)).template));
      if (method === "POST") return installStatus(node, b, req);
    }
    if (b && c === "events" && segments.length === 3 && method === "POST") return serverEvent(node, b, req);
    if (b && c === "transfer" && (d === "success" || d === "failure") && method === "POST") {
      await ownServer(node, b);
      throw new RemoteError(501, "transfers are not supported by this panel yet");
    }
  }
  if (a === "activity" && segments.length === 1 && method === "POST") return activity(node, req);
  if (a === "sftp" && b === "auth" && segments.length === 2 && method === "POST") return sftpAuth(node, req);
  if (a === "backups") throw new RemoteError(404, "backup not found");

  throw new RemoteError(404, `no route for ${method} /api/remote/${segments.join("/")}`);
}

export async function handleRemoteRequest(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname;
  const idx = path.indexOf("/api/remote");
  const segments = path
    .slice(idx + "/api/remote".length)
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  try {
    const node = await authenticateNode(req);
    return await route(req, node, segments);
  } catch (e) {
    if (e instanceof RemoteError) return json({ error: e.message }, e.status);
    console.error("[remote] unhandled error", req.method, path, e);
    return json({ error: "internal panel error" }, 500);
  }
}
