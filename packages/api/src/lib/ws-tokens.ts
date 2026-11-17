// Remembers which websocket tokens (jti) the panel issued per server+user until they expire, so
// access changes can revoke them on wings right away (POST /api/servers/:id/ws/deny).
// In-memory: after a panel restart older tokens can't be revoked, but they expire within the TTL.

import { signWebsocketToken } from "@vango-panel/wings";

type Issued = { jti: string; expiresAt: number };

const store = globalThis as typeof globalThis & { __vangoWsTokens?: Map<string, Issued[]> };
store.__vangoWsTokens ??= new Map();
const issued = store.__vangoWsTokens;

const key = (serverId: string, userId: string) => `${serverId}:${userId}`;

function live(list: Issued[] | undefined): Issued[] {
  const now = Math.floor(Date.now() / 1000);
  return (list ?? []).filter((t) => t.expiresAt > now);
}

/** signWebsocketToken + remember the jti for revocation. */
export function issueWebsocketToken(opts: Parameters<typeof signWebsocketToken>[0]) {
  const t = signWebsocketToken(opts);
  const k = key(opts.serverId, opts.userId);
  issued.set(k, [...live(issued.get(k)), { jti: t.jti, expiresAt: t.expiresAt }]);
  return t;
}

/** Live jtis for this user on this server; forgets them (they're about to be denied). */
export function takeLiveJtis(serverId: string, userId: string): string[] {
  const k = key(serverId, userId);
  const jtis = live(issued.get(k)).map((t) => t.jti);
  issued.delete(k);
  return jtis;
}
