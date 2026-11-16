"use client";
import { Button } from "@vango-panel/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@vango-panel/ui/components/card";
import { Input } from "@vango-panel/ui/components/input";
import { cn } from "@vango-panel/ui/lib/utils";
import { Copy } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { ConsoleLine } from "@/hooks/use-server-socket";
import { formatBytes, formatCpu, formatMib, formatUptime } from "@/lib/format";

import { can, useServerShell } from "./server-shell";

export default function ConsoleTab() {
  const { server, socket, stats, running } = useServerShell();
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <ConsoleBox
          lines={socket.lines}
          status={socket.status}
          canSend={can(server.permissions, "control.console") && socket.status === "connected" && running}
          onSend={socket.sendCommand}
        />
        <div className="grid content-start gap-3">
          <Stat label="CPU" value={formatCpu(stats?.cpu_absolute, server.limits.cpuPercent || undefined)} />
          <Stat label="Memory" value={`${formatBytes(stats?.memory_bytes)} / ${formatMib(server.limits.memoryMib)}`} />
          <Stat label="Disk" value={`${formatBytes(stats?.disk_bytes)} / ${formatMib(server.limits.diskMib)}`} />
          <Stat
            label="Network"
            value={`↓ ${formatBytes(stats?.network.rx_bytes)} · ↑ ${formatBytes(stats?.network.tx_bytes)}`}
          />
          <Stat label="Uptime" value={running ? formatUptime(stats?.uptime) : "–"} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>SFTP</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            <SftpDetails sftp={server.sftp} />
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Allocations</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 font-mono">
            {server.allocations.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {a.address} {a.isDefault ? <span className="text-muted-foreground">(primary)</span> : null}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`Copy ${a.address}`}
                  onClick={() => navigator.clipboard.writeText(a.address).then(() => toast.success("Copied"))}
                >
                  <Copy />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function SftpDetails({ sftp }: { sftp: ReturnType<typeof useServerShell>["server"]["sftp"] }) {
  if (!sftp.allowed) return <p className="text-muted-foreground">You don't have SFTP access to this server.</p>;
  const command = `sftp -P ${sftp.port} ${sftp.username}@${sftp.host}`;
  return (
    <>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate bg-zinc-950 px-2 py-1.5 text-zinc-100" title={command}>
          {command}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigator.clipboard.writeText(command).then(() => toast.success("Copied"))}
        >
          <Copy /> Copy
        </Button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-muted-foreground">
        <dt>host</dt>
        <dd>
          {sftp.host}:{sftp.port}
        </dd>
        <dt>user</dt>
        <dd>{sftp.username}</dd>
      </dl>
      {sftp.hasKeys ? (
        <p className="text-muted-foreground">Log in with one of your SSH keys (no password).</p>
      ) : (
        <p>
          SFTP uses SSH keys only.{" "}
          <Link href="/account" className="underline underline-offset-2">
            Add an SSH key on your Account page
          </Link>{" "}
          to connect.
        </p>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2 ring-1 ring-foreground/10">
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      <div className="font-mono text-sm">{value}</div>
    </div>
  );
}

const LINE_STYLE: Record<ConsoleLine["kind"], string> = {
  output: "text-zinc-100",
  install: "text-sky-300",
  daemon: "text-yellow-300",
  error: "text-red-400",
};

function ConsoleBox({
  lines,
  status,
  canSend,
  onSend,
}: {
  lines: ConsoleLine[];
  status: string;
  canSend: boolean;
  onSend: (cmd: string) => boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when lines change
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="flex min-h-0 flex-col ring-1 ring-foreground/10">
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        role="log"
        aria-label="Console output"
        aria-live="off"
        className="h-[28rem] overflow-y-auto bg-zinc-950 p-3 font-mono text-xs leading-relaxed"
      >
        {status !== "connected" ? (
          <div className="text-zinc-500">
            {status === "connecting" ? "Connecting to node…" : status === "reconnecting" ? "Reconnecting…" : "Disconnected"}
          </div>
        ) : null}
        {lines.map((l) => (
          <div key={l.id} className={cn("whitespace-pre-wrap break-all", LINE_STYLE[l.kind])}>
            {l.text || " "}
          </div>
        ))}
      </div>
      <form
        className="flex border-t"
        onSubmit={(e) => {
          e.preventDefault();
          const cmd = input.trim();
          if (!cmd) return;
          if (onSend(cmd)) {
            setHistory((h) => [cmd, ...h.filter((x) => x !== cmd)].slice(0, 50));
            setHistIdx(-1);
            setInput("");
          } else {
            toast.error("Console is not connected");
          }
        }}
      >
        <span className="px-2 py-1.5 font-mono text-muted-foreground text-xs">$</span>
        <Input
          className="border-0 font-mono focus-visible:ring-0"
          placeholder={canSend ? "Type a command…" : "Server must be running to send commands"}
          disabled={!canSend}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" && history.length) {
              e.preventDefault();
              const i = Math.min(history.length - 1, histIdx + 1);
              setHistIdx(i);
              setInput(history[i] ?? "");
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              const i = histIdx - 1;
              setHistIdx(Math.max(-1, i));
              setInput(i < 0 ? "" : (history[i] ?? ""));
            }
          }}
        />
      </form>
    </div>
  );
}
