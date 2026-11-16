"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vango-panel/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@vango-panel/ui/components/card";
import { Input } from "@vango-panel/ui/components/input";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Field, NumberInput, PageShell, Table } from "@/components/form";
import { NodeStatus } from "@/components/node-status";
import { formatBytes, formatMib } from "@/lib/format";
import { trpc } from "@/utils/trpc";

export default function NodesPage() {
  const nodes = useQuery(trpc.admin.nodes.list.queryOptions());
  const [creating, setCreating] = useState(false);

  return (
    <PageShell
      title="Nodes"
      description="Machines running the wings daemon."
      actions={<Button onClick={() => setCreating((v) => !v)}>{creating ? "Cancel" : "Add node"}</Button>}
    >
      {creating ? <CreateNode /> : null}
      <Table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Daemon URL</th>
            <th>Status</th>
            <th>Memory</th>
            <th>Disk</th>
            <th>Servers</th>
            <th>Allocations</th>
          </tr>
        </thead>
        <tbody>
          {nodes.data?.map((n) => (
            <tr key={n.id}>
              <td>
                <Link className="underline underline-offset-2" href={`/admin/nodes/${n.id}` as Route}>
                  {n.name}
                </Link>
              </td>
              <td className="font-mono">{n.url}</td>
              <td>
                <NodeStatus id={n.id} />
              </td>
              <td>
                {/* Used amounts are plain sizes: formatMib treats 0 as "Unlimited" (a limit convention). */}
                {formatBytes(n.allocatedMemoryMib * 1024 * 1024)} / {n.memoryMib ? formatMib(n.memoryMib) : "∞"}
              </td>
              <td>
                {formatBytes(n.allocatedDiskMib * 1024 * 1024)} / {n.diskMib ? formatMib(n.diskMib) : "∞"}
              </td>
              <td>{n.servers}</td>
              <td>{n.allocations}</td>
            </tr>
          ))}
          {nodes.data?.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-muted-foreground">
                No nodes yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </PageShell>
  );
}

function CreateNode() {
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    url: "http://127.0.0.1:8080",
    publicUrl: "",
    sftpHost: "",
    sftpPort: 2022,
    memoryMib: 0,
    diskMib: 0,
  });
  const create = useMutation(
    trpc.admin.nodes.create.mutationOptions({
      onSuccess: async ({ id, warning }) => {
        await qc.invalidateQueries({ queryKey: trpc.admin.nodes.list.queryKey() });
        toast.success("Node created. Copy its config.yml to the machine.");
        if (warning) toast.warning(warning);
        router.push(`/admin/nodes/${id}` as Route);
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>New node</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(form);
          }}
        >
          <Field label="Name">
            <Input required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="node-1" />
          </Field>
          <Field label="Daemon URL" hint="How the panel reaches wings.">
            <Input required value={form.url} onChange={(e) => set("url", e.target.value)} />
          </Field>
          <Field
            label="Browser URL"
            hint="Optional. Leave empty and the panel relays the console, uploads and downloads itself, so the node only needs to be reachable from the panel. Set it only if browsers should connect to wings directly."
          >
            <Input
              value={form.publicUrl}
              onChange={(e) => set("publicUrl", e.target.value)}
              placeholder="https://node-1.example.proxy.netbird.io"
            />
          </Field>
          <Field
            label="Public host"
            hint="IP or hostname users connect to for SFTP and for servers bound to 0.0.0.0."
          >
            <Input
              required
              value={form.sftpHost}
              onChange={(e) => set("sftpHost", e.target.value)}
              placeholder="192.168.2.108"
            />
          </Field>
          <Field label="SFTP port">
            <NumberInput value={form.sftpPort} onChange={(v) => set("sftpPort", v)} />
          </Field>
          <Field label="Memory capacity (MiB)" hint="0 = don't track">
            <NumberInput value={form.memoryMib} onChange={(v) => set("memoryMib", v)} />
          </Field>
          <Field label="Disk capacity (MiB)" hint="0 = don't track">
            <NumberInput value={form.diskMib} onChange={(v) => set("diskMib", v)} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              Create node
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
