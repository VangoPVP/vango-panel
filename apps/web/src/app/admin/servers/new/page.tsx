"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vango-panel/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@vango-panel/ui/components/card";
import { Checkbox } from "@vango-panel/ui/components/checkbox";
import { Input } from "@vango-panel/ui/components/input";
import { Label } from "@vango-panel/ui/components/label";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Field, PageShell, Select } from "@/components/form";
import { trpc } from "@/utils/trpc";

import { DEFAULT_LIMITS, ImageSelect, LimitsCard, OwnerSelect, VariablesCard } from "../server-form";

export default function NewServerPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const nodes = useQuery(trpc.admin.nodes.list.queryOptions());
  const templates = useQuery(trpc.admin.templates.list.queryOptions());

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [allocationId, setAllocationId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [env, setEnv] = useState<Record<string, string>>({});
  const [image, setImage] = useState("");
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [startOnCompletion, setStart] = useState(true);
  const [skipInstall, setSkipInstall] = useState(false);

  const allocations = useQuery({
    ...trpc.admin.servers.freeAllocations.queryOptions({ nodeId }),
    enabled: !!nodeId,
  });
  const template = templates.data?.find((t) => t.id === templateId);

  const create = useMutation(
    trpc.admin.servers.create.mutationOptions({
      onSuccess: ({ id }) => {
        toast.success("Server created; the node is installing it.");
        qc.invalidateQueries({ queryKey: trpc.admin.servers.pathKey() });
        router.push(`/servers/${id}` as Route);
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  return (
    <PageShell title="New server">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({
            name,
            description,
            ownerId,
            nodeId,
            allocationId,
            templateId,
            environment: env,
            image: image.trim() || undefined,
            limits: { ...limits, threads: limits.threads || null },
            startOnCompletion,
            skipInstall,
          });
        }}
      >
        <Card size="sm">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Description">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label="Owner" className="sm:col-span-2">
              <OwnerSelect value={ownerId} onChange={setOwnerId} />
            </Field>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Placement</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <Field label="Node">
              <Select
                required
                value={nodeId}
                onChange={(e) => {
                  setNodeId(e.target.value);
                  setAllocationId("");
                }}
              >
                <option value="" disabled>
                  Select node
                </option>
                {nodes.data?.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Primary allocation"
              hint={nodeId && allocations.data?.length === 0 ? "No free allocations on this node" : undefined}
            >
              <Select required value={allocationId} onChange={(e) => setAllocationId(e.target.value)} disabled={!nodeId}>
                <option value="" disabled>
                  Select ip:port
                </option>
                {allocations.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ip}:{a.port}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Template">
              <Select
                required
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setEnv({});
                  setImage(templates.data?.find((t) => t.id === e.target.value)?.image ?? "");
                }}
              >
                <option value="" disabled>
                  Select template
                </option>
                {templates.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            {template ? (
              <Field label="Docker image" className="sm:col-span-3">
                <ImageSelect key={template.id} images={template.dockerImages} value={image} onChange={setImage} />
              </Field>
            ) : null}
            <div className="flex items-center gap-2">
              <Checkbox id="start" checked={startOnCompletion} onCheckedChange={(v) => setStart(v === true)} />
              <Label htmlFor="start">Start after install</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="skip" checked={skipInstall} onCheckedChange={(v) => setSkipInstall(v === true)} />
              <Label htmlFor="skip">Skip install script</Label>
            </div>
          </CardContent>
        </Card>

        {template ? <VariablesCard variables={template.variables} values={env} onChange={setEnv} /> : null}
        <LimitsCard value={limits} onChange={setLimits} />

        <div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create server"}
          </Button>
        </div>
      </form>
    </PageShell>
  );
}
