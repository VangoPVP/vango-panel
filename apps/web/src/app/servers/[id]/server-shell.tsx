"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vango-panel/ui/components/button";
import { Skeleton } from "@vango-panel/ui/components/skeleton";
import { cn } from "@vango-panel/ui/lib/utils";
import type { PowerAction, ResourceUsage } from "@vango-panel/wings/protocol";
import { Play, RotateCw, Skull, Square } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext } from "react";
import { toast } from "sonner";

import { displayState, StateBadge } from "@/components/server-state";
import { useServerSocket } from "@/hooks/use-server-socket";
import { type RouterOutputs, trpc } from "@/utils/trpc";

import { FeatureDialogs } from "./feature-dialogs";

export type ServerData = RouterOutputs["servers"]["get"];

export function can(perms: readonly string[], p: string) {
  return perms.includes("*") || perms.includes(p);
}

type ShellContext = {
  server: ServerData;
  socket: ReturnType<typeof useServerSocket>;
  state: string | null;
  stats: ResourceUsage | null;
  running: boolean;
  refresh: () => Promise<void>;
};

const Ctx = createContext<ShellContext | null>(null);

export function useServerShell(): ShellContext {
  const c = useContext(Ctx);
  if (!c) throw new Error("useServerShell must be used inside <ServerShell>");
  return c;
}

export default function ServerShell({ id, children }: { id: string; children: React.ReactNode }) {
  const qc = useQueryClient();
  const server = useQuery(trpc.servers.get.queryOptions({ id }));
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.servers.get.queryKey({ id }) });

  if (server.isPending) return <Skeleton className="h-96" />;
  if (server.isError) return <p className="text-destructive text-sm">{server.error.message}</p>;
  return (
    <ShellInner server={server.data} refresh={refresh}>
      {children}
    </ShellInner>
  );
}

function ShellInner({
  server,
  refresh,
  children,
}: {
  server: ServerData;
  refresh: () => Promise<void>;
  children: React.ReactNode;
}) {
  const socket = useServerSocket(server.id, { onInstallCompleted: () => void refresh() });
  const power = useMutation(
    trpc.servers.power.mutationOptions({
      onError: (e) => toast.error(e.message),
    }),
  );

  const state = socket.state ?? server.lastState;
  const shown = displayState({ status: server.status, suspended: server.suspended, state });
  const stats = socket.stats ?? server.lastUtilization;
  const blocked = server.suspended || server.status === "installing";
  const perms = server.permissions;
  const def = server.allocations.find((a) => a.isDefault) ?? server.allocations[0];
  const running = state === "running" || state === "starting";
  const action = (a: PowerAction) => power.mutate({ id: server.id, action: a });

  return (
    <Ctx.Provider value={{ server, socket, state, stats, running, refresh }}>
      <div className="grid gap-4">
        <FeatureDialogs server={server} lines={socket.lines} state={state} />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-3 font-semibold text-xl">
              {server.name} <StateBadge state={shown} />
            </h1>
            <p className="text-muted-foreground text-xs">
              {def ? def.address : "no allocation"} · {server.node.name} · {server.template.name}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={blocked || power.isPending || running || state === "stopping" || !can(perms, "control.start")}
              onClick={() => action("start")}
            >
              <Play /> Start
            </Button>
            <Button
              variant="outline"
              disabled={blocked || power.isPending || !running || !can(perms, "control.restart")}
              onClick={() => action("restart")}
            >
              <RotateCw /> Restart
            </Button>
            <Button
              variant="outline"
              disabled={blocked || power.isPending || !running || !can(perms, "control.stop")}
              onClick={() => action("stop")}
            >
              <Square /> Stop
            </Button>
            <Button
              variant="destructive"
              disabled={blocked || power.isPending || state === "offline" || !state || !can(perms, "control.kill")}
              onClick={() => action("kill")}
              title="SIGKILL the server"
            >
              <Skull /> Kill
            </Button>
          </div>
        </div>

        <ServerTabs id={server.id} perms={perms} />

        {server.suspended ? (
          <Banner tone="warn">This server is suspended. Contact an administrator.</Banner>
        ) : server.status === "installing" ? (
          <Banner tone="info">This server is installing. Output appears in the console.</Banner>
        ) : server.status === "install_failed" || server.status === "reinstall_failed" ? (
          <Banner tone="error">The last installation failed. An administrator can reinstall it.</Banner>
        ) : null}
        {socket.error ? <Banner tone="error">{socket.error}</Banner> : null}

        {children}
      </div>
    </Ctx.Provider>
  );
}

function ServerTabs({ id, perms }: { id: string; perms: string[] }) {
  const path = usePathname();
  const base = `/servers/${id}`;
  const tabs = [
    { href: base, label: "Console", active: path === base, show: true },
    { href: `${base}/files`, label: "Files", active: path.startsWith(`${base}/files`), show: can(perms, "file.read") },
    { href: `${base}/startup`, label: "Startup", active: path.startsWith(`${base}/startup`), show: can(perms, "startup.read") },
  ];
  return (
    <nav className="flex gap-1 border-b text-sm" aria-label="Server sections">
      {tabs
        .filter((t) => t.show)
        .map((t) => (
          <Link
            key={t.href}
            href={t.href as Route}
            aria-current={t.active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5",
              t.active ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
    </nav>
  );
}

export function Banner({ tone, children }: { tone: "info" | "warn" | "error"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "px-3 py-2 text-xs ring-1",
        tone === "info" && "bg-blue-500/10 ring-blue-500/30",
        tone === "warn" && "bg-yellow-500/10 ring-yellow-500/30",
        tone === "error" && "bg-destructive/10 text-destructive ring-destructive/30",
      )}
    >
      {children}
    </div>
  );
}
