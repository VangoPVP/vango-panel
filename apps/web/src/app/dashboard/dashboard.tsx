"use client";
import { useQuery } from "@tanstack/react-query";
import { buttonVariants } from "@vango-panel/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vango-panel/ui/components/card";
import { Skeleton } from "@vango-panel/ui/components/skeleton";
import type { Route } from "next";
import Link from "next/link";

import { displayState, StateBadge } from "@/components/server-state";
import { formatBytes, formatCpu, formatMib } from "@/lib/format";
import { trpc } from "@/utils/trpc";

type View = "mine" | "others";

export function ViewToggle({ view }: { view: View }) {
  const item = (v: View, label: string) => (
    <Link
      href={(v === "mine" ? "/dashboard" : "/dashboard?view=others") as Route}
      aria-current={view === v ? "page" : undefined}
      className={buttonVariants({ variant: view === v ? "default" : "outline" })}
    >
      {label}
    </Link>
  );
  return (
    <nav className="flex" aria-label="Which servers to show">
      {item("mine", "My servers")}
      {item("others", "Other servers")}
    </nav>
  );
}

export default function Dashboard({ view }: { view: View }) {
  const servers = useQuery({ ...trpc.servers.list.queryOptions({ scope: view }), refetchInterval: 15_000 });

  if (servers.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }
  if (servers.isError) return <p className="text-destructive text-sm">{servers.error.message}</p>;
  if (!servers.data.length) {
    return (
      <p className="text-muted-foreground text-sm">
        {view === "others" ? "There are no servers owned by other users." : "You don't have any servers yet."}
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {servers.data.map((s) => {
        const u = s.lastUtilization;
        return (
          <Link key={s.id} href={`/servers/${s.id}` as Route} className="transition-opacity hover:opacity-80">
            <Card size="sm" className="h-full">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span className="truncate">{s.name}</span>
                  <StateBadge state={displayState({ status: s.status, suspended: s.suspended, state: s.lastState })} />
                </CardTitle>
                <CardDescription>
                  {s.address ?? "no allocation"} · {s.node.name}
                  {view === "others" ? (
                    <span className="block truncate">
                      Owner: {s.owner.name} ({s.owner.email})
                    </span>
                  ) : null}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-2 text-muted-foreground">
                <div>
                  <div className="text-[10px] uppercase">CPU</div>
                  {formatCpu(u?.cpu_absolute, s.limits.cpuPercent || undefined)}
                </div>
                <div>
                  <div className="text-[10px] uppercase">Memory</div>
                  {formatBytes(u?.memory_bytes)} / {formatMib(s.limits.memoryMib)}
                </div>
                <div>
                  <div className="text-[10px] uppercase">Disk</div>
                  {formatBytes(u?.disk_bytes)} / {formatMib(s.limits.diskMib)}
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
