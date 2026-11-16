"use client";

import type { PowerState, ResourceUsage } from "@vango-panel/wings/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import { stripAnsi } from "@/lib/format";
import { trpcClient } from "@/utils/trpc";

export type ConsoleLine = { id: number; text: string; kind: "output" | "install" | "daemon" | "error" };
export type SocketStatus = "connecting" | "connected" | "reconnecting" | "closed";

const MAX_LINES = 1000;

type Frame = { event: string; args?: string[] };

/** One console connection: straight to wings, or relayed through the panel. */
type Conn = { send: (frame: Frame) => boolean; close: () => void };

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;

/** Explains the common misconfigurations behind a failed browser → wings connection. */
function socketHint(socketUrl: string): string {
  let u: URL;
  try {
    u = new URL(socketUrl);
  } catch {
    return "";
  }
  const page = window.location;
  if (LOOPBACK.test(u.hostname) && !LOOPBACK.test(page.hostname)) {
    return " That address points at your own machine, not the node. Set the node's Browser URL in Admin → Nodes, or clear it to relay through the panel.";
  }
  if (page.protocol === "https:" && u.protocol === "ws:") {
    return " Browsers block insecure ws:// from an https:// page. Set an https Browser URL for the node, or clear it to relay through the panel.";
  }
  return "";
}

export function useServerSocket(serverId: string, opts: { onInstallCompleted?: () => void } = {}) {
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [state, setState] = useState<PowerState | null>(null);
  const [stats, setStats] = useState<ResourceUsage | null>(null);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const connRef = useRef<Conn | null>(null);
  const nextId = useRef(0);
  const onInstallCompleted = useRef(opts.onInstallCompleted);
  onInstallCompleted.current = opts.onInstallCompleted;

  const push = useCallback((kind: ConsoleLine["kind"], text: string) => {
    setLines((prev) => {
      const next = [...prev, { id: nextId.current++, kind, text: stripAnsi(text) }];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const fetchToken = () => trpcClient.servers.websocket.mutate({ id: serverId });

    const scheduleReconnect = () => {
      if (disposed) return;
      setStatus("reconnecting");
      const delay = Math.min(30_000, 1000 * 2 ** attempt++);
      retryTimer = setTimeout(connect, delay);
    };

    const closed = (conn: Conn) => {
      if (connRef.current === conn) connRef.current = null;
      if (disposed) setStatus("closed");
      else scheduleReconnect();
    };

    /** Shared handling of wings frames, whichever way they arrive. */
    function onFrame(msg: Frame, conn: Conn, reauth?: () => void) {
      const arg = msg.args?.[0] ?? "";
      switch (msg.event) {
        case "auth success":
          attempt = 0;
          setStatus("connected");
          setError(null);
          setLines([]);
          conn.send({ event: "send logs", args: [] });
          conn.send({ event: "send stats", args: [] });
          break;
        case "status":
          setState(arg as PowerState);
          break;
        case "stats":
          try {
            const s = JSON.parse(arg) as ResourceUsage;
            setStats(s);
            setState(s.state);
          } catch {
          }
          break;
        case "console output":
          push("output", arg);
          break;
        case "install output":
          push("install", arg);
          break;
        case "install started":
          push("daemon", "Installation started");
          break;
        case "install completed":
          push("daemon", "Installation completed");
          onInstallCompleted.current?.();
          break;
        case "daemon message":
          push("daemon", arg);
          break;
        case "daemon error":
          push("error", arg);
          break;
        case "token expiring":
        case "token expired":
          reauth?.(); // relayed consoles refresh their token on the panel
          break;
        case "jwt error":
          setError(`Console auth failed: ${arg}`);
          conn.close();
          break;
        case "deleted":
          disposed = true;
          setStatus("closed");
          setError("This server was deleted.");
          conn.close();
          break;
      }
    }

    function openDirect(socketUrl: string, token: string) {
      let ws: WebSocket;
      try {
        ws = new WebSocket(socketUrl);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Invalid websocket URL");
        scheduleReconnect();
        return;
      }
      const conn: Conn = {
        send: (frame) => {
          if (ws.readyState !== WebSocket.OPEN) return false;
          ws.send(JSON.stringify(frame));
          return true;
        },
        close: () => ws.close(),
      };
      connRef.current = conn;

      const reauth = async () => {
        try {
          const creds = await fetchToken();
          if (creds.mode === "direct") conn.send({ event: "auth", args: [creds.token] });
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not refresh console token");
        }
      };

      ws.onopen = () => conn.send({ event: "auth", args: [token] });
      ws.onmessage = (ev) => {
        try {
          onFrame(JSON.parse(String(ev.data)) as Frame, conn, () => void reauth());
        } catch {
        }
      };
      ws.onerror = () => setError(`Could not reach the node's websocket (${socketUrl}).${socketHint(socketUrl)}`);
      ws.onclose = () => closed(conn);
    }

    function openRelay() {
      const base = `/api/relay/servers/${serverId}/console`;
      const es = new EventSource(base);
      let session: string | null = null;
      let ended = false;

      const conn: Conn = {
        send: (frame) => {
          if (!session || ended) return false;
          void fetch(base, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session, event: frame.event, args: frame.args ?? [] }),
          })
            .then(async (r) => {
              if (!r.ok && r.status !== 409) {
                const body = (await r.json().catch(() => null)) as { error?: string } | null;
                setError(body?.error ?? `Console relay error (HTTP ${r.status})`);
              }
            })
            .catch(() => setError("Lost connection to the panel"));
          return true;
        },
        close: () => end(),
      };
      connRef.current = conn;

      function end() {
        if (ended) return;
        ended = true;
        es.close();
        closed(conn);
      }

      es.addEventListener("relay", (ev) => {
        session = (JSON.parse((ev as MessageEvent<string>).data) as { session: string }).session;
      });
      es.addEventListener("relay-error", (ev) => {
        setError((JSON.parse((ev as MessageEvent<string>).data) as { message: string }).message);
      });
      es.onmessage = (ev) => {
        try {
          onFrame(JSON.parse(ev.data) as Frame, conn);
        } catch {
        }
      };
      // EventSource would silently auto-reconnect; use our own backoff + fresh session instead.
      es.onerror = () => end();
    }

    async function connect() {
      if (disposed) return;
      setStatus(attempt ? "reconnecting" : "connecting");
      let creds: Awaited<ReturnType<typeof fetchToken>>;
      try {
        creds = await fetchToken();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not get console token");
        scheduleReconnect();
        return;
      }
      if (disposed) return;
      if (creds.mode === "relay") openRelay();
      else openDirect(creds.socket, creds.token);
    }

    void connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      connRef.current?.close();
      connRef.current = null;
    };
  }, [serverId, push]);

  const sendCommand = useCallback((command: string) => {
    return connRef.current?.send({ event: "send command", args: [command] }) ?? false;
  }, []);

  return { status, state, stats, lines, error, sendCommand };
}
