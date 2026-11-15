"use client";
import { useQuery } from "@tanstack/react-query";
import { buttonVariants } from "@vango-panel/ui/components/button";
import type { Route } from "next";
import Link from "next/link";

import { PageShell, Table } from "@/components/form";
import { displayState, StateBadge } from "@/components/server-state";
import { formatMib } from "@/lib/format";
import { trpc } from "@/utils/trpc";

export default function AdminServersPage() {
  const servers = useQuery({ ...trpc.admin.servers.list.queryOptions(), refetchInterval: 15_000 });
  return (
    <PageShell
      title="Servers"
      actions={
        <Link className={buttonVariants()} href="/admin/servers/new">
          New server
        </Link>
      }
    >
      <Table>
        <thead>
          <tr>
            <th>Name</th>
            <th>State</th>
            <th>Owner</th>
            <th>Node</th>
            <th>Address</th>
            <th>Template</th>
            <th>Limits</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {servers.data?.map((s) => (
            <tr key={s.id}>
              <td>
                <Link className="underline underline-offset-2" href={`/admin/servers/${s.id}` as Route}>
                  {s.name}
                </Link>
              </td>
              <td>
                <StateBadge state={displayState({ status: s.status, suspended: s.suspended, state: s.lastState })} />
              </td>
              <td>{s.owner.email}</td>
              <td>
                <Link className="underline underline-offset-2" href={`/admin/nodes/${s.node.id}` as Route}>
                  {s.node.name}
                </Link>
              </td>
              <td className="font-mono">{s.address ?? "–"}</td>
              <td>{s.template.name}</td>
              <td>
                {formatMib(s.memoryMib)} RAM · {formatMib(s.diskMib)} disk · {s.cpuPercent ? `${s.cpuPercent}%` : "∞"} CPU
              </td>
              <td className="text-right">
                <Link className={buttonVariants({ variant: "ghost", size: "xs" })} href={`/servers/${s.id}` as Route}>
                  Console
                </Link>
              </td>
            </tr>
          ))}
          {servers.data?.length === 0 ? (
            <tr>
              <td colSpan={8} className="text-muted-foreground">
                No servers yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </PageShell>
  );
}
