import { createHmac, randomUUID } from "node:crypto";

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export function signHs256(claims: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(claims));
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export const WS_TOKEN_TTL_SECONDS = 10 * 60;

export function signWebsocketToken(opts: {
  nodeToken: string;
  userId: string;
  serverId: string;
  permissions: string[];
  ttlSeconds?: number;
}): { token: string; jti: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (opts.ttlSeconds ?? WS_TOKEN_TTL_SECONDS);
  const jti = randomUUID();
  const token = signHs256(
    {
      jti,
      iat: now,
      nbf: now - 5,
      exp,
      user_uuid: opts.userId,
      server_uuid: opts.serverId,
      permissions: opts.permissions,
    },
    opts.nodeToken,
  );
  return { token, jti, expiresAt: exp };
}

export function signFileDownloadToken(opts: { nodeToken: string; serverId: string; filePath: string; ttlSeconds?: number }) {
  const now = Math.floor(Date.now() / 1000);
  return signHs256(
    {
      iat: now,
      nbf: now - 5,
      exp: now + (opts.ttlSeconds ?? 5 * 60),
      server_uuid: opts.serverId,
      file_path: opts.filePath,
      unique_id: randomUUID(),
    },
    opts.nodeToken,
  );
}

export function signUploadToken(opts: { nodeToken: string; serverId: string; userId: string; ttlSeconds?: number }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (opts.ttlSeconds ?? 30 * 60);
  return {
    token: signHs256(
      { iat: now, nbf: now - 5, exp, server_uuid: opts.serverId, user_uuid: opts.userId, unique_id: randomUUID() },
      opts.nodeToken,
    ),
    expiresAt: exp,
  };
}
