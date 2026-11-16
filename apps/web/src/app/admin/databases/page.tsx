"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vango-panel/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vango-panel/ui/components/card";
import { Checkbox } from "@vango-panel/ui/components/checkbox";
import { Input } from "@vango-panel/ui/components/input";
import { Label } from "@vango-panel/ui/components/label";
import { remoteListError } from "@vango-panel/wings/databases";
import { useState } from "react";
import { toast } from "sonner";

import { Field, NumberInput, PageShell, Select, Table } from "@/components/form";
import { type RouterOutputs, trpc } from "@/utils/trpc";

type Host = RouterOutputs["admin"]["databaseHosts"]["list"][number];

type Form = {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  connectHost: string;
  allowedRemote: string;
  allowAllNodes: boolean;
  nodeId: string;
  maxDatabases: number;
};

const EMPTY: Form = {
  name: "",
  host: "127.0.0.1",
  port: 3306,
  username: "vango",
  password: "",
  connectHost: "",
  allowedRemote: "172.31.250.%",
  allowAllNodes: true,
  nodeId: "",
  maxDatabases: 0,
};

const onError = (e: { message: string }) => toast.error(e.message);

export default function DatabaseHostsPage() {
  const qc = useQueryClient();
  const hosts = useQuery(trpc.admin.databaseHosts.list.queryOptions());
  const [editing, setEditing] = useState<Host | "new" | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.admin.databaseHosts.pathKey() });

  const test = useMutation(
    trpc.admin.databaseHosts.test.mutationOptions({
      onSuccess: (r) =>
        r.canGrant
          ? toast.success(`Connected: ${r.version}`)
          : toast.warning(`Connected (${r.version}), but the account lacks GRANT OPTION on *.*`),
      onError,
    }),
  );
  const sync = useMutation(
    trpc.admin.databaseHosts.sync.mutationOptions({
      onSuccess: (r) => (r.warning ? toast.warning(r.warning) : toast.success(`Synced users for ${r.synced} database(s)`)),
      onError,
    }),
  );
  const del = useMutation(
    trpc.admin.databaseHosts.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Deleted");
        invalidate();
      },
      onError,
    }),
  );

  return (
    <PageShell
      title="Database hosts"
      description="MariaDB/MySQL servers the panel creates per-server databases on. Enable databases per server under Servers → edit."
      actions={
        <Button onClick={() => setEditing(editing === "new" ? null : "new")}>
          {editing === "new" ? "Cancel" : "Add host"}
        </Button>
      }
    >
      {editing ? (
        <HostForm
          key={editing === "new" ? "new" : editing.id}
          host={editing === "new" ? null : editing}
          onDone={() => {
            setEditing(null);
            invalidate();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      <Table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Panel connects to</th>
            <th>Servers connect to</th>
            <th>Users allowed from</th>
            <th>Node</th>
            <th>Databases</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {hosts.data?.map((h) => (
            <tr key={h.id}>
              <td>{h.name}</td>
              <td className="font-mono">
                {h.username}@{h.host}:{h.port}
              </td>
              <td className="font-mono">
                {h.connectHost ?? h.host}:{h.port}
              </td>
              <td className="font-mono" title={h.allowAllNodes ? "Includes every node's public host" : undefined}>
                {h.sources.join(", ")}
              </td>
              <td>{h.node?.name ?? <span className="text-muted-foreground">any</span>}</td>
              <td>
                {h.databases}
                {h.maxDatabases ? ` / ${h.maxDatabases}` : ""}
              </td>
              <td className="whitespace-nowrap text-right">
                <Button variant="ghost" size="xs" disabled={test.isPending} onClick={() => test.mutate({ id: h.id })}>
                  Test
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={sync.isPending || h.databases === 0}
                  title="Create/refresh/remove database users so MariaDB matches the allowed sources"
                  onClick={() => sync.mutate({ id: h.id })}
                >
                  Sync users
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setEditing(h)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={del.isPending || h.databases > 0}
                  title={h.databases > 0 ? "Delete its databases first" : undefined}
                  onClick={() => confirm(`Delete host ${h.name}?`) && del.mutate({ id: h.id })}
                >
                  Delete
                </Button>
              </td>
            </tr>
          ))}
          {hosts.data?.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-muted-foreground">
                No database hosts yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </PageShell>
  );
}

function HostForm({ host, onDone, onCancel }: { host: Host | null; onDone: () => void; onCancel: () => void }) {
  const nodes = useQuery(trpc.admin.nodes.list.queryOptions());
  const [form, setForm] = useState<Form>(
    host
      ? {
          name: host.name,
          host: host.host,
          port: host.port,
          username: host.username,
          password: "",
          connectHost: host.connectHost ?? "",
          allowedRemote: host.allowedRemote,
          allowAllNodes: host.allowAllNodes,
          nodeId: host.nodeId ?? "",
          maxDatabases: host.maxDatabases ?? 0,
        }
      : EMPTY,
  );
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const done = (r: { warning?: string }) => {
    if (r.warning) toast.warning(r.warning);
    else toast.success(host ? "Saved" : "Database host added");
    onDone();
  };
  const create = useMutation(trpc.admin.databaseHosts.create.mutationOptions({ onSuccess: done, onError }));
  const update = useMutation(trpc.admin.databaseHosts.update.mutationOptions({ onSuccess: done, onError }));
  const pending = create.isPending || update.isPending;
  const remoteError = remoteListError(form.allowedRemote);
  const nodeHosts = (nodes.data ?? []).map((n) => n.sftpHost).join(", ");

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{host ? `Edit ${host.name}` : "Add database host"}</CardTitle>
        <CardDescription>
          The account needs <code>ALL PRIVILEGES ON *.* WITH GRANT OPTION</code>. The connection is tested when you save.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const payload = {
              name: form.name,
              host: form.host,
              port: form.port,
              username: form.username,
              connectHost: form.connectHost,
              allowedRemote: form.allowedRemote,
              allowAllNodes: form.allowAllNodes,
              nodeId: form.nodeId,
              maxDatabases: form.maxDatabases > 0 ? form.maxDatabases : null,
            };
            if (host) update.mutate({ id: host.id, ...payload, password: form.password || undefined });
            else create.mutate({ ...payload, password: form.password });
          }}
        >
          <Field label="Name">
            <Input required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="mariadb-1" />
          </Field>
          <Field label="Node" hint="Only servers on this node create databases here. Empty = any node.">
            <Select value={form.nodeId} onChange={(e) => set("nodeId", e.target.value)}>
              <option value="">Any node</option>
              {nodes.data?.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Host" hint="How the panel connects, e.g. 127.0.0.1 if MariaDB runs next to the panel.">
            <Input required value={form.host} onChange={(e) => set("host", e.target.value)} />
          </Field>
          <Field label="Port">
            <NumberInput value={form.port} onChange={(v) => set("port", v)} min={1} max={65535} />
          </Field>
          <Field label="Username">
            <Input required value={form.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Password" hint={host ? "Leave empty to keep the current password." : undefined}>
            <Input
              type="password"
              required={!host}
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field
            label="Servers connect to"
            hint="Address shown to servers: the database machine's LAN IP (e.g. 192.168.2.108) works from every node. Never localhost."
          >
            <Input
              value={form.connectHost}
              onChange={(e) => set("connectHost", e.target.value)}
              placeholder="not set (uses Host)"
            />
          </Field>
          <Field
            label="Users allowed from"
            hint={
              remoteError ? (
                <span className="text-destructive">{remoteError}</span>
              ) : (
                "Comma-separated MySQL host parts. 172.31.250.% = containers on the database's own machine."
              )
            }
          >
            <Input
              required
              value={form.allowedRemote}
              onChange={(e) => set("allowedRemote", e.target.value)}
              aria-invalid={remoteError ? true : undefined}
            />
          </Field>
          <div className="grid gap-1 sm:col-span-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="allow-all-nodes"
                checked={form.allowAllNodes}
                onCheckedChange={(v) => set("allowAllNodes", v === true)}
              />
              <Label htmlFor="allow-all-nodes">Also allow every node</Label>
            </div>
            <p className="text-muted-foreground text-xs">
              Adds each node's public host{nodeHosts ? ` (${nodeHosts})` : ""}: containers on other nodes connect from
              their node's IP. New nodes are added automatically.
            </p>
          </div>
          <Field label="Max databases" hint="0 = unlimited">
            <NumberInput value={form.maxDatabases} onChange={(v) => set("maxDatabases", v)} min={0} />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={pending || !!remoteError}>
              {pending ? "Saving…" : host ? "Save" : "Add host"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
