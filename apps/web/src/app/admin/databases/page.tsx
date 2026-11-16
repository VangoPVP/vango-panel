"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vango-panel/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vango-panel/ui/components/card";
import { Input } from "@vango-panel/ui/components/input";
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
  nodeId: "",
  maxDatabases: 0,
};

export default function DatabaseHostsPage() {
  const qc = useQueryClient();
  const hosts = useQuery(trpc.admin.databaseHosts.list.queryOptions());
  const [editing, setEditing] = useState<Host | "new" | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.admin.databaseHosts.pathKey() });
  const onError = (e: { message: string }) => toast.error(e.message);

  const test = useMutation(
    trpc.admin.databaseHosts.test.mutationOptions({
      onSuccess: (r) =>
        r.canGrant
          ? toast.success(`Connected: ${r.version}`)
          : toast.warning(`Connected (${r.version}), but the account lacks GRANT OPTION on *.*`),
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
              <td className="font-mono">{h.allowedRemote}</td>
              <td>{h.node?.name ?? <span className="text-muted-foreground">any</span>}</td>
              <td>
                {h.databases}
                {h.maxDatabases ? ` / ${h.maxDatabases}` : ""}
              </td>
              <td className="whitespace-nowrap text-right">
                <Button variant="ghost" size="xs" disabled={test.isPending} onClick={() => test.mutate({ id: h.id })}>
                  Test
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
          nodeId: host.nodeId ?? "",
          maxDatabases: host.maxDatabases ?? 0,
        }
      : EMPTY,
  );
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const opts = {
    onSuccess: () => {
      toast.success(host ? "Saved" : "Database host added");
      onDone();
    },
    onError: (e: { message: string }) => toast.error(e.message),
  };
  const create = useMutation(trpc.admin.databaseHosts.create.mutationOptions(opts));
  const update = useMutation(trpc.admin.databaseHosts.update.mutationOptions(opts));
  const pending = create.isPending || update.isPending;

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
          <Field label="Node" hint="Only servers on this node use it. Empty = any node.">
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
            hint="Address shown to servers, e.g. the docker gateway 172.31.250.1. Empty = Host. Never localhost."
          >
            <Input value={form.connectHost} onChange={(e) => set("connectHost", e.target.value)} placeholder="172.31.250.1" />
          </Field>
          <Field
            label="Users allowed from"
            hint="MySQL host part for created users. 172.31.250.% = containers only. Applies to new databases."
          >
            <Input required value={form.allowedRemote} onChange={(e) => set("allowedRemote", e.target.value)} />
          </Field>
          <Field label="Max databases" hint="0 = unlimited">
            <NumberInput value={form.maxDatabases} onChange={(v) => set("maxDatabases", v)} min={0} />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Testing connection…" : host ? "Save" : "Add host"}
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
