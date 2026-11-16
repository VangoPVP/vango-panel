"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vango-panel/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vango-panel/ui/components/card";
import { Input } from "@vango-panel/ui/components/input";
import { Skeleton } from "@vango-panel/ui/components/skeleton";
import type { Route } from "next";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Field, NumberInput, PageShell, Table } from "@/components/form";
import { NodeStatus } from "@/components/node-status";
import { formatBytes } from "@/lib/format";
import { type RouterOutputs, trpc } from "@/utils/trpc";

export default function NodePage() {
  const { id } = useParams<{ id: string }>();
  const node = useQuery(trpc.admin.nodes.get.queryOptions({ id }));

  if (node.isPending) return <Skeleton className="h-96" />;
  if (node.isError) return <p className="text-destructive text-sm">{node.error.message}</p>;
  const n = node.data;

  return (
    <PageShell
      title={n.name}
      description={
        <>
          {n.url} · <NodeStatus id={n.id} />
        </>
      }
      actions={<DangerActions node={n} />}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <SystemCard id={n.id} />
        <EditNode node={n} />
      </div>
      <ConfigCard id={n.id} />
      <Allocations node={n} />
    </PageShell>
  );
}

type NodeData = RouterOutputs["admin"]["nodes"]["get"];

function SystemCard({ id }: { id: string }) {
  const sys = useQuery(trpc.admin.nodes.system.queryOptions({ id }));
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Daemon</CardTitle>
        <CardDescription>GET /api/system</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-1">
        {sys.isPending ? (
          <Skeleton className="h-24" />
        ) : sys.data?.online ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Version</dt>
            <dd>wings {sys.data.info.version}</dd>
            <dt className="text-muted-foreground">OS</dt>
            <dd>
              {sys.data.info.os_name} ({sys.data.info.architecture}, kernel {sys.data.info.kernel_version})
            </dd>
            <dt className="text-muted-foreground">CPU / RAM</dt>
            <dd>
              {sys.data.info.cpu_count} cores · {formatBytes(sys.data.info.memory_bytes)}
            </dd>
            <dt className="text-muted-foreground">Docker</dt>
            <dd>{sys.data.info.docker_version ?? "unavailable"}</dd>
            <dt className="text-muted-foreground">Servers</dt>
            <dd>{sys.data.info.servers}</dd>
          </dl>
        ) : (
          <p className="text-destructive">{sys.data?.error ?? sys.error?.message}</p>
        )}
      </CardContent>
    </Card>
  );
}

function EditNode({ node }: { node: NodeData }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: node.name,
    url: node.url,
    publicUrl: node.publicUrl ?? "",
    sftpHost: node.sftpHost,
    sftpPort: node.sftpPort,
    memoryMib: node.memoryMib,
    diskMib: node.diskMib,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const update = useMutation(
    trpc.admin.nodes.update.mutationOptions({
      onSuccess: (r) => {
        if (r.warning) toast.warning(`Saved. ${r.warning}`);
        else toast.success("Saved");
        qc.invalidateQueries({ queryKey: trpc.admin.nodes.pathKey() });
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ id: node.id, ...form });
          }}
        >
          <Field label="Name">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Daemon URL" hint="How the panel reaches wings.">
            <Input value={form.url} onChange={(e) => set("url", e.target.value)} />
          </Field>
          <Field
            label="Browser URL"
            hint="Optional. Empty = the panel relays console and file transfers (node only needs to be reachable from the panel)."
          >
            <Input
              value={form.publicUrl}
              onChange={(e) => set("publicUrl", e.target.value)}
              placeholder="https://node-1.example.proxy.netbird.io"
            />
          </Field>
          <Field label="Public host" hint="Users connect here for SFTP and for servers bound to 0.0.0.0.">
            <Input value={form.sftpHost} onChange={(e) => set("sftpHost", e.target.value)} />
          </Field>
          <Field label="SFTP port">
            <NumberInput value={form.sftpPort} onChange={(v) => set("sftpPort", v)} />
          </Field>
          <Field label="Memory (MiB)">
            <NumberInput value={form.memoryMib} onChange={(v) => set("memoryMib", v)} />
          </Field>
          <Field label="Disk (MiB)">
            <NumberInput value={form.diskMib} onChange={(v) => set("diskMib", v)} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={update.isPending}>
              Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ConfigCard({ id }: { id: string }) {
  const [show, setShow] = useState(false);
  const cfg = useQuery({ ...trpc.admin.nodes.configuration.queryOptions({ id }), enabled: show });
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>config.yml</CardTitle>
        <CardDescription>
          Merge into the node's wings config (default <code>/etc/pterodactyl/config.yml</code>) and restart wings.
          Contains the node token.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShow((s) => !s)}>
            {show ? "Hide" : "Show configuration"}
          </Button>
          {show && cfg.data ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigator.clipboard.writeText(cfg.data.yaml).then(() => toast.success("Copied"))}
            >
              Copy
            </Button>
          ) : null}
        </div>
        {show ? (
          <pre className="overflow-x-auto bg-zinc-950 p-3 font-mono text-xs text-zinc-100">
            {cfg.data?.yaml ?? "Loading…"}
          </pre>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Allocations({ node }: { node: NodeData }) {
  const qc = useQueryClient();
  const [ip, setIp] = useState("0.0.0.0");
  const [ipAlias, setIpAlias] = useState("");
  const [ports, setPorts] = useState("");
  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.admin.nodes.pathKey() });
  const add = useMutation(
    trpc.admin.nodes.addAllocations.mutationOptions({
      onSuccess: (r) => {
        toast.success(`Added ${r.created}${r.skipped ? `, ${r.skipped} already existed` : ""}`);
        setPorts("");
        invalidate();
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const remove = useMutation(
    trpc.admin.nodes.deleteAllocation.mutationOptions({ onSuccess: invalidate, onError: (e) => toast.error(e.message) }),
  );

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Allocations</CardTitle>
        <CardDescription>
          Bind IP is what Docker publishes the port on (0.0.0.0 = all interfaces). Users see the alias if set,
          otherwise the node's public host ({node.sftpHost}) for 0.0.0.0 binds.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate({ nodeId: node.id, ip, ipAlias, ports });
          }}
        >
          <Field label="Bind IP" className="w-40">
            <Input value={ip} onChange={(e) => setIp(e.target.value)} />
          </Field>
          <Field label="Alias (optional)" className="w-48">
            <Input value={ipAlias} onChange={(e) => setIpAlias(e.target.value)} placeholder="play.example.com" />
          </Field>
          <Field label="Ports" className="w-64">
            <Input value={ports} onChange={(e) => setPorts(e.target.value)} placeholder="25565-25570, 25600" />
          </Field>
          <Button type="submit" disabled={add.isPending || !ports}>
            Add
          </Button>
        </form>
        <Table>
          <thead>
            <tr>
              <th>Bind</th>
              <th>Alias</th>
              <th>Users connect to</th>
              <th>Server</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {node.allocations.map((a) => (
              <AllocationRow
                key={a.id}
                allocation={a}
                onChanged={invalidate}
                onRemove={() => remove.mutate({ id: a.id })}
                removing={remove.isPending}
              />
            ))}
          </tbody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AllocationRow({
  allocation: a,
  onChanged,
  onRemove,
  removing,
}: {
  allocation: NodeData["allocations"][number];
  onChanged: () => void;
  onRemove: () => void;
  removing: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [ip, setIp] = useState(a.ip);
  const [ipAlias, setIpAlias] = useState(a.ipAlias ?? "");
  const update = useMutation(
    trpc.admin.nodes.updateAllocation.mutationOptions({
      onSuccess: (r) => {
        if (!r.rebound) toast.success("Saved");
        else if (r.synced) toast.success("Saved. Restart the server to bind the new IP.");
        else toast.warning(`Saved, but the node wasn't updated: ${r.warning}`);
        setEditing(false);
        onChanged();
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const loopback = /^127\.|^::1$/.test(a.ip);

  if (editing) {
    return (
      <tr>
        <td>
          <Input className="h-7 w-36 font-mono" value={ip} onChange={(e) => setIp(e.target.value)} aria-label="Bind IP" />
          <span className="ml-1 font-mono text-muted-foreground">:{a.port}</span>
        </td>
        <td colSpan={2}>
          <Input
            className="h-7 w-48 font-mono"
            value={ipAlias}
            onChange={(e) => setIpAlias(e.target.value)}
            placeholder="none"
            aria-label="Alias"
          />
        </td>
        <td>{a.server?.name ?? <span className="text-muted-foreground">free</span>}</td>
        <td className="whitespace-nowrap text-right">
          <Button
            size="xs"
            disabled={update.isPending}
            onClick={() => update.mutate({ id: a.id, ip: ip.trim(), ipAlias })}
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setIp(a.ip);
              setIpAlias(a.ipAlias ?? "");
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="font-mono">
        {a.ip}:{a.port}
        {loopback ? (
          <span className="ml-2 text-amber-500" title="Only reachable from the node itself">
            loopback
          </span>
        ) : null}
      </td>
      <td className="font-mono">{a.ipAlias ?? <span className="text-muted-foreground">–</span>}</td>
      <td className="font-mono">{a.address}</td>
      <td>
        {a.server ? (
          <Link className="underline underline-offset-2" href={`/admin/servers/${a.server.id}` as Route}>
            {a.server.name}
          </Link>
        ) : (
          <span className="text-muted-foreground">free</span>
        )}
      </td>
      <td className="whitespace-nowrap text-right">
        <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
          Edit
        </Button>
        {!a.server ? (
          <Button variant="ghost" size="xs" disabled={removing} onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

function DangerActions({ node }: { node: NodeData }) {
  const router = useRouter();
  const qc = useQueryClient();
  const rotate = useMutation(
    trpc.admin.nodes.rotateToken.mutationOptions({
      onSuccess: () => {
        toast.success("Token rotated. Update the node's config.yml and restart wings.");
        qc.invalidateQueries({ queryKey: trpc.admin.nodes.pathKey() });
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const del = useMutation(
    trpc.admin.nodes.delete.mutationOptions({
      onSuccess: (r) => {
        if (r.warning) toast.warning(r.warning);
        qc.invalidateQueries({ queryKey: trpc.admin.nodes.pathKey() });
        router.push("/admin/nodes");
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  return (
    <>
      <Button
        variant="outline"
        disabled={rotate.isPending}
        onClick={() => {
          if (confirm("Rotate the node token? wings will be locked out until its config.yml is updated."))
            rotate.mutate({ id: node.id });
        }}
      >
        Rotate token
      </Button>
      <Button
        variant="destructive"
        disabled={del.isPending || node._count.servers > 0}
        title={node._count.servers ? "Delete or move its servers first" : undefined}
        onClick={() => {
          if (confirm(`Delete node ${node.name}?`)) del.mutate({ id: node.id });
        }}
      >
        Delete
      </Button>
    </>
  );
}
