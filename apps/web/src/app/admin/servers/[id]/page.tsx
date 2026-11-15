"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, buttonVariants } from "@vango-panel/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@vango-panel/ui/components/card";
import { Input } from "@vango-panel/ui/components/input";
import { Skeleton } from "@vango-panel/ui/components/skeleton";
import type { Route } from "next";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Field, PageShell, Textarea } from "@/components/form";
import { displayState, StateBadge } from "@/components/server-state";
import { type RouterOutputs, trpc } from "@/utils/trpc";

import { ImageSelect, LimitsCard, OwnerSelect, VariablesCard } from "../server-form";

export default function AdminServerPage() {
  const { id } = useParams<{ id: string }>();
  const server = useQuery(trpc.admin.servers.get.queryOptions({ id }));
  if (server.isPending) return <Skeleton className="h-96" />;
  if (server.isError) return <p className="text-destructive text-sm">{server.error.message}</p>;
  return <EditServer key={server.data.updatedAt.toString()} server={server.data} />;
}

type Server = RouterOutputs["admin"]["servers"]["get"];

function EditServer({ server: s }: { server: Server }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState(s.name);
  const [description, setDescription] = useState(s.description);
  const [ownerId, setOwnerId] = useState(s.ownerId);
  const [image, setImage] = useState(s.image);
  const [startup, setStartup] = useState(s.startup);
  const [env, setEnv] = useState<Record<string, string>>(s.environment);
  const [limits, setLimits] = useState({
    memoryMib: s.memoryMib,
    swapMib: s.swapMib,
    diskMib: s.diskMib,
    cpuPercent: s.cpuPercent,
    ioWeight: s.ioWeight,
    threads: s.threads ?? "",
    oomDisabled: s.oomDisabled,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.admin.servers.pathKey() });
  const onError = (e: { message: string }) => toast.error(e.message);
  const syncResult = (r: { synced: boolean; warning?: string }) => {
    if (r.synced) toast.success("Saved and pushed to the node");
    else toast.warning(`Saved. The node wasn't updated (${r.warning}); it will pick this up on next start.`);
    invalidate();
  };

  const update = useMutation(trpc.admin.servers.update.mutationOptions({ onSuccess: syncResult, onError }));
  const suspend = useMutation(trpc.admin.servers.setSuspended.mutationOptions({ onSuccess: syncResult, onError }));
  const reinstall = useMutation(
    trpc.admin.servers.reinstall.mutationOptions({
      onSuccess: () => {
        toast.success("Reinstall started");
        invalidate();
      },
      onError,
    }),
  );
  const del = useMutation(
    trpc.admin.servers.delete.mutationOptions({
      onSuccess: (r) => {
        if (r.warning) toast.warning(r.warning);
        else toast.success("Server deleted");
        invalidate();
        router.push("/admin/servers");
      },
      onError,
    }),
  );

  return (
    <PageShell
      title={
        <span className="flex items-center gap-3">
          {s.name} <StateBadge state={displayState({ status: s.status, suspended: s.suspended, state: s.lastState })} />
        </span>
      }
      description={
        <>
          {s.id} · node{" "}
          <Link className="underline" href={`/admin/nodes/${s.node.id}` as Route}>
            {s.node.name}
          </Link>{" "}
          · {s.template.name} · {s.allocations.map((a) => `${a.ip}:${a.port}`).join(", ")}
        </>
      }
      actions={
        <>
          <Link className={buttonVariants({ variant: "outline" })} href={`/servers/${s.id}` as Route}>
            Console
          </Link>
          <Button
            variant="outline"
            disabled={suspend.isPending}
            onClick={() => suspend.mutate({ id: s.id, suspended: !s.suspended })}
          >
            {s.suspended ? "Unsuspend" : "Suspend"}
          </Button>
          <Button
            variant="outline"
            disabled={reinstall.isPending || s.status === "installing"}
            onClick={() => confirm("Reinstall? The install script runs again over the existing files.") && reinstall.mutate({ id: s.id })}
          >
            Reinstall
          </Button>
          <Button
            variant="destructive"
            disabled={del.isPending}
            onClick={(e) => {
              if (!confirm(`Delete ${s.name} and all its files on the node?`)) return;
              del.mutate({ id: s.id, force: e.shiftKey });
            }}
            title="Shift-click to force (if the node is offline)"
          >
            Delete
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({
            id: s.id,
            name,
            description,
            ownerId,
            image,
            startup,
            environment: env,
            limits: { ...limits, threads: limits.threads || null },
          });
        }}
      >
        <Card size="sm">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Description">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label="Owner" className="sm:col-span-2">
              <OwnerSelect value={ownerId} onChange={setOwnerId} initialLabel={`${s.owner.email} (${s.owner.name})`} />
            </Field>
            <Field label="Docker image">
              <ImageSelect images={s.template.dockerImages} value={image} onChange={setImage} />
            </Field>
            <Field label="Startup command" className="sm:col-span-2">
              <Textarea value={startup} onChange={(e) => setStartup(e.target.value)} className="min-h-16" />
            </Field>
          </CardContent>
        </Card>
        <VariablesCard variables={s.template.variables} values={env} onChange={setEnv} />
        <LimitsCard value={limits} onChange={setLimits} />
        <div>
          <Button type="submit" disabled={update.isPending}>
            Save
          </Button>
        </div>
      </form>
    </PageShell>
  );
}
