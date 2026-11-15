"use client";

import type { PowerState, ResourceUsage } from "@vango-panel/wings/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import { stripAnsi } from "@/lib/format";
import { trpcClient } from "@/utils/trpc";

export type ConsoleLine = { id: number; text: string; kind: "output" | "install" | "daemon" | "error" };
export type SocketStatus = "connecting" | "connected" | "reconnecting" | "closed";

const MAX_LINES = 1000;

type Frame = { event: string; args?: string[] };

export function useServerSocket(serverId: string, opts: { onInstallCompleted?: () => void } = {}) {
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [state, setState] = useState<PowerState | null>(null);
  const [stats, setStats] = useState<ResourceUsage | null>(null);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
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

    async function reauth(ws: WebSocket) {
      try {
        const { token } = await fetchToken();
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event: "auth", args: [token] }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not refresh console token");
      }
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

      let ws: WebSocket;
      try {
        ws = new WebSocket(creds.socket);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Invalid websocket URL");
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => ws.send(JSON.stringify({ event: "auth", args: [creds.token] }));

      ws.onmessage = (ev) => {
        let msg: Frame;
        try {
          msg = JSON.parse(String(ev.data)) as Frame;
        } catch {
          return;
        }
        const arg = msg.args?.[0] ?? "";
        switch (msg.event) {
          case "auth success":
            attempt = 0;
            setStatus("connected");
            setError(null);
            setLines([]);
            ws.send(JSON.stringify({ event: "send logs", args: [] }));
            ws.send(JSON.stringify({ event: "send stats", args: [] }));
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
            void reauth(ws);
            break;
          case "jwt error":
            setError(`Console auth failed: ${arg}`);
            ws.close();
            break;
          case "deleted":
            disposed = true;
            setStatus("closed");
            setError("This server was deleted.");
            ws.close();
            break;
        }
      };

      ws.onerror = () => setError("Could not reach the node's websocket");
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (disposed) setStatus("closed");
        else scheduleReconnect();
      };
    }

    void connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [serverId, push]);

  const sendCommand = useCallback((command: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ event: "send command", args: [command] }));
    return true;
  }, []);

  return { status, state, stats, lines, error, sendCommand };
}
