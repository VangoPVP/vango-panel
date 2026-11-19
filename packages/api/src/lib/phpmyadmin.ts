// phpMyAdmin auto-login (see @vango-panel/wings/phpmyadmin for the flow). The panel side:
//   issuePhpMyAdminLogin  – called from tRPC by a signed-in user; returns the one-time signon URL.
//   handlePhpMyAdminRedeem – POST /api/phpmyadmin/redeem, called server-to-server by vango-signon.php
//                            with `Authorization: Bearer <PHPMYADMIN_SIGNON_SECRET>`.

import { TRPCError } from "@trpc/server";
import prisma from "@vango-panel/db";
import { env } from "@vango-panel/env/server";
import {
  bearerCredential,
  decryptSecret,
  hashPhpMyAdminToken,
  hasPermission,
  isLoopbackIp,
  isWildcardIp,
  PHPMYADMIN_TOKEN_RE,
  PHPMYADMIN_TOKEN_TTL_MS,
  phpMyAdminSignonUrl,
  randomToken,
  safeEqual,
} from "@vango-panel/wings";

import { loadAccessibleServer } from "./wings";

export function phpMyAdminConfig(): { url: string; secret: string } | null {
  if (!env.PHPMYADMIN_URL || !env.PHPMYADMIN_SIGNON_SECRET) return null;
  return { url: env.PHPMYADMIN_URL, secret: env.PHPMYADMIN_SIGNON_SECRET };
}

/** Creates a one-time token for `userId` on `databaseId` and returns the URL that redeems it. */
export async function issuePhpMyAdminLogin(userId: string, databaseId: string): Promise<string> {
  const config = phpMyAdminConfig();
  if (!config) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "phpMyAdmin is not configured on this panel" });
  const token = randomToken(32);
  const now = Date.now();
  await prisma.phpMyAdminToken.deleteMany({ where: { expiresAt: { lt: new Date(now) } } });
  await prisma.phpMyAdminToken.create({
    data: {
      tokenHash: hashPhpMyAdminToken(token),
      databaseId,
      userId,
      expiresAt: new Date(now + PHPMYADMIN_TOKEN_TTL_MS),
    },
  });
  return phpMyAdminSignonUrl(config.url, token);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const INVALID = "This phpMyAdmin link is invalid, expired or already used. Open phpMyAdmin from the panel again.";

export async function handlePhpMyAdminRedeem(req: Request): Promise<Response> {
  const config = phpMyAdminConfig();
  if (!config) return json({ error: "phpMyAdmin is not configured on this panel" }, 404);
  const credential = bearerCredential(req.headers.get("authorization"));
  if (!credential || !safeEqual(credential, config.secret)) return json({ error: "Unauthorized" }, 401);

  let token: unknown;
  try {
    token = ((await req.json()) as { token?: unknown })?.token;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (typeof token !== "string" || !PHPMYADMIN_TOKEN_RE.test(token)) return json({ error: INVALID }, 400);

  try {
    const tokenHash = hashPhpMyAdminToken(token);
    const row = await prisma.phpMyAdminToken.findUnique({
      where: { tokenHash },
      include: { database: { include: { host: true } }, user: { select: { id: true, role: true } } },
    });
    // Deleting is the single-use guard: of two concurrent redeems only one deletes the row.
    const { count } = await prisma.phpMyAdminToken.deleteMany({ where: { tokenHash } });
    if (!row || count !== 1 || row.expiresAt.getTime() <= Date.now()) return json({ error: INVALID }, 410);

    // Re-check access: the user may have lost it since the token was issued.
    const db = row.database;
    const { server, permissions } = await loadAccessibleServer(row.user, db.serverId).catch(() => ({
      server: null,
      permissions: [] as string[],
    }));
    if (!server || !hasPermission(permissions, "database.view-password")) {
      return json({ error: "You no longer have access to this database." }, 403);
    }
    if (server.suspended) return json({ error: "This server is suspended." }, 403);

    const host = db.host.connectHost ?? db.host.host;
    if (isLoopbackIp(host) || isWildcardIp(host)) {
      return json(
        { error: 'The database host has no reachable address. An administrator needs to set "Servers connect to".' },
        409,
      );
    }
    return json({
      host,
      port: db.host.port,
      username: db.username,
      password: decryptSecret(db.passwordEncrypted),
      database: db.name,
    });
  } catch (e) {
    console.error("[phpmyadmin] redeem failed", e);
    return json({ error: "The panel could not complete the login." }, 500);
  }
}
