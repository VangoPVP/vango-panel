// Panel relay for nodes browsers can't reach directly (no Browser URL set on the node).
// The browser only talks to the panel's own origin; the panel talks to wings on the Daemon URL.
//
//   console:   GET  /api/relay/servers/:id/console  → Server-Sent Events stream of wings frames
//              POST /api/relay/servers/:id/console  → { session, event, args } into that wings socket
//   download:  GET  /api/relay/servers/:id/download?token=…   → streamed from wings /download/file
//   upload:    PUT  /api/relay/servers/:id/upload?token=…&…    → one chunk, forwarded to /upload/chunk
//
// Every request needs a panel session with access to the server. The panel only ever forwards to
// that server's node and to those three wings endpoints; wings still checks its own signed tokens.

import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { auth } from "@vango-panel/auth";
import { signWebsocketToken, UPLOAD_CHUNK_BYTES } from "@vango-panel/wings";
import { z } from "zod";

import { loadAccessibleServer, requirePermission, uuidRe, websocketPermissions, wingsFor } from "./lib/wings";

type SessionUser = { id: string; role?: string | null };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TRPC_STATUS: Partial<Record<TRPCError["code"], number>> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  BAD_REQUEST: 400,
};

function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof TRPCError) return Response.json({ error: e.message }, { status: TRPC_STATUS[e.code] ?? 500 });
  console.error("[relay]", e);
  return Response.json({ error: "Relay error" }, { status: 500 });
}

async function authorize(req: Request, serverId: string, perm: string) {
  if (!uuidRe.test(serverId)) throw new HttpError(404, "Server not found");
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) throw new HttpError(401, "Not signed in");
  const user: SessionUser = session.user;
  const { server, permissions } = await loadAccessibleServer(user, serverId);
  requirePermission(permissions, perm);
  return { user, server, permissions };
}

function handle(fn: (req: Request, serverId: string) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    try {
      return await fn(req, (await ctx.params).id);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Console

type ConsoleSession = { userId: string; serverId: string; ws: WebSocket };

// One wings socket per open console tab. Kept on globalThis so dev-mode module reloads share it.
const store = globalThis as typeof globalThis & { __vangoRelaySessions?: Map<string, ConsoleSession> };
store.__vangoRelaySessions ??= new Map();
const sessions = store.__vangoRelaySessions;

const MAX_SESSIONS_PER_USER = 20;
const KEEPALIVE_MS = 15_000;
/** Events the browser may send into wings. Wings enforces permissions per event from the JWT. */
const CLIENT_EVENTS = new Set(["send command", "set state", "send logs", "send stats"]);

const consoleFrame = z.object({
  session: z.string().uuid(),
  event: z.string().refine((e) => CLIENT_EVENTS.has(e), "event not allowed"),
  args: z.array(z.string().max(4096)).max(1).default([]),
});

async function consoleStream(req: Request, serverId: string): Promise<Response> {
  const { user, server } = await authorize(req, serverId, "websocket.connect");
  let open = 0;
  for (const s of sessions.values()) if (s.userId === user.id) open++;
  if (open >= MAX_SESSIONS_PER_USER) throw new HttpError(429, "Too many open consoles");

  const client = wingsFor(server.node);
  const nodeName = server.node.name;
  // Re-checked on every token refresh so revoked access ends the console.
  const freshToken = async () => {
    const { server: s, permissions } = await loadAccessibleServer(user, serverId);
    requirePermission(permissions, "websocket.connect");
    return signWebsocketToken({
      nodeToken: wingsFor(s.node).nodeToken,
      userId: user.id,
      serverId,
      permissions: websocketPermissions(user, permissions),
    }).token;
  };

  const id = randomUUID();
  const encoder = new TextEncoder();
  let teardown = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let done = false;
      const write = (chunk: string) => {
        if (done) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          teardown();
        }
      };
      const named = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      const ws = new WebSocket(client.internalWebsocketUrl(serverId));
      sessions.set(id, { userId: user.id, serverId, ws });
      const keepalive = setInterval(() => write(": keepalive\n\n"), KEEPALIVE_MS);

      teardown = () => {
        if (done) return;
        done = true;
        clearInterval(keepalive);
        sessions.delete(id);
        try {
          ws.close();
        } catch {}
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", () => teardown(), { once: true });

      const authenticate = async () => {
        try {
          const token = await freshToken();
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event: "auth", args: [token] }));
        } catch (e) {
          named("relay-error", { message: e instanceof Error ? e.message : "Console access denied" });
          teardown();
        }
      };

      named("relay", { session: id });
      ws.onopen = () => void authenticate();
      ws.onmessage = (ev) => {
        const text = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
        let event: unknown;
        try {
          event = (JSON.parse(text) as { event?: unknown }).event;
        } catch {
          return;
        }
        // Token refresh happens here, not in the browser.
        if (event === "token expiring" || event === "token expired") return void authenticate();
        write(`data: ${text}\n\n`);
      };
      ws.onerror = () => named("relay-error", { message: `The panel could not reach node ${nodeName}.` });
      ws.onclose = () => teardown();
    },
    cancel() {
      teardown();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}

async function consoleSend(req: Request, serverId: string): Promise<Response> {
  const { user } = await authorize(req, serverId, "websocket.connect");
  const parsed = consoleFrame.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid frame");
  const { session, event, args } = parsed.data;
  const s = sessions.get(session);
  if (!s || s.userId !== user.id || s.serverId !== serverId) throw new HttpError(404, "Console session not found");
  if (s.ws.readyState !== WebSocket.OPEN) throw new HttpError(409, "Console is not connected");
  s.ws.send(JSON.stringify({ event, args }));
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------------------------------------
// Files

const PASS_HEADERS = ["content-type", "content-length", "content-disposition", "last-modified", "etag"];

async function upstream(url: string, init: RequestInit, nodeName: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new HttpError(502, `The panel could not reach node ${nodeName}.`);
  }
}

async function download(req: Request, serverId: string): Promise<Response> {
  const { server } = await authorize(req, serverId, "file.read-content");
  const token = new URL(req.url).searchParams.get("token");
  if (!token) throw new HttpError(400, "Missing token");
  const res = await upstream(wingsFor(server.node).internalDownloadUrl(token), { signal: req.signal }, server.node.name);
  const headers = new Headers();
  for (const h of PASS_HEADERS) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, headers });
}

// One chunk is at most UPLOAD_CHUNK_BYTES, so buffering it is fine and works on every runtime.
const MAX_UPLOAD_BODY = UPLOAD_CHUNK_BYTES + 1024 * 1024;

async function upload(req: Request, serverId: string): Promise<Response> {
  const { server } = await authorize(req, serverId, "file.create");
  const declared = Number(req.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BODY) throw new HttpError(413, "Chunk too large");
  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_UPLOAD_BODY) throw new HttpError(413, "Chunk too large");
  const res = await upstream(
    `${wingsFor(server.node).internalUploadChunkUrl()}${new URL(req.url).search}`,
    { method: "PUT", body, headers: { "Content-Type": "application/octet-stream" } },
    server.node.name,
  );
  return new Response(await res.arrayBuffer(), {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
  });
}

export const relayConsoleStream = handle(consoleStream);
export const relayConsoleSend = handle(consoleSend);
export const relayDownload = handle(download);
export const relayUpload = handle(upload);
