"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vango-panel/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vango-panel/ui/components/card";
import { Input } from "@vango-panel/ui/components/input";
import { Skeleton } from "@vango-panel/ui/components/skeleton";
import { validateVariables } from "@vango-panel/wings/rules";
import { useState } from "react";
import { toast } from "sonner";

import { Field, Select, Textarea } from "@/components/form";
import { type RouterOutputs, trpc } from "@/utils/trpc";

import { can, useServerShell } from "../server-shell";

type Startup = RouterOutputs["servers"]["startup"]["get"];

export default function StartupPage() {
  const { server } = useServerShell();
  const startup = useQuery({
    ...trpc.servers.startup.get.queryOptions({ id: server.id }),
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  const [version, setVersion] = useState(0);
  if (startup.isPending || (!startup.isFetchedAfterMount && !startup.isError)) return <Skeleton className="h-80" />;
  if (startup.isError) return <p className="text-destructive text-sm">{startup.error.message}</p>;
  return (
    <StartupForm
      key={version}
      data={startup.data}
      onSaved={async () => {
        await startup.refetch();
        setVersion((v) => v + 1);
      }}
    />
  );
}

function StartupForm({ data, onSaved }: { data: Startup; onSaved: () => Promise<void> }) {
  const { server, running } = useServerShell();
  const qc = useQueryClient();
  const [command, setCommand] = useState(data.startup);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(data.variables.map((v) => [v.key, v.value])),
  );

  const invalidate = () =>
    Promise.all([onSaved(), qc.invalidateQueries({ queryKey: trpc.servers.get.queryKey({ id: server.id }) })]);

  const power = useMutation(trpc.servers.power.mutationOptions({ onError: (e) => toast.error(e.message) }));
  const applyNow = () => {
    const action = running ? "restart" : "start";
    if (!can(server.permissions, `control.${action}`)) return;
    power.mutate({ id: server.id, action }, { onSuccess: () => toast.success(running ? "Restarting" : "Starting") });
  };
  const savedToast = (r: { synced: boolean; warning?: string }) => {
    const action = running ? "Restart now" : "Start now";
    const canApply = can(server.permissions, running ? "control.restart" : "control.start");
    const msg = r.synced ? "Saved. Applies on the next start." : `Saved, but the node wasn't updated (${r.warning}).`;
    toast.success(msg, canApply ? { action: { label: action, onClick: applyNow } } : undefined);
  };

  const update = useMutation(
    trpc.servers.startup.update.mutationOptions({
      onSuccess: async (r) => {
        await invalidate();
        if (r.changed) savedToast(r);
        else toast.info("Nothing to save");
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const setImage = useMutation(
    trpc.servers.setDockerImage.mutationOptions({
      onSuccess: async (r) => {
        await invalidate();
        savedToast(r);
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const errors = validateVariables(data.variables, values);
  const changedVars = Object.fromEntries(
    data.variables.filter((v) => v.editable && values[v.key] !== v.value).map((v) => [v.key, values[v.key] ?? ""]),
  );
  const commandChanged = data.canEditCommand && command.trim() !== data.startup;
  const dirty = commandChanged || Object.keys(changedVars).length > 0;
  const choices = Object.entries(data.imageChoices);

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (Object.keys(errors).length) {
          toast.error("Fix the highlighted variables first");
          return;
        }
        update.mutate({
          id: server.id,
          ...(Object.keys(changedVars).length ? { environment: changedVars } : {}),
          ...(commandChanged ? { startup: command.trim() } : {}),
        });
      }}
    >
      <Card size="sm">
        <CardHeader>
          <CardTitle>Startup command</CardTitle>
          <CardDescription>What the server runs, with variables filled in.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <pre className="overflow-x-auto whitespace-pre-wrap break-all bg-zinc-950 p-3 font-mono text-xs text-zinc-100">
            {data.rendered}
          </pre>
          {data.canEditCommand ? (
            <Field
              label="Command template"
              hint={
                <>
                  <code>{"{{VARIABLE}}"}</code> is replaced with the variables below, plus{" "}
                  <code>{"{{SERVER_MEMORY}}"}</code>, <code>{"{{SERVER_IP}}"}</code>, <code>{"{{SERVER_PORT}}"}</code>.
                </>
              }
            >
              <Textarea value={command} onChange={(e) => setCommand(e.target.value)} className="min-h-20" />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={command === data.templateStartup}
                  onClick={() => setCommand(data.templateStartup)}
                >
                  Reset to template default
                </Button>
                {command !== data.startup ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setCommand(data.startup)}>
                    Undo changes
                  </Button>
                ) : null}
              </div>
            </Field>
          ) : null}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Docker image</CardTitle>
          <CardDescription>The runtime (e.g. Java version). Changing it applies on the next start.</CardDescription>
        </CardHeader>
        <CardContent>
          {choices.length > 1 && data.canChangeImage ? (
            <Select
              value={data.image}
              disabled={setImage.isPending}
              onChange={(e) => setImage.mutate({ id: server.id, image: e.target.value })}
              aria-label="Docker image"
            >
              {choices.map(([label, image]) => (
                <option key={label} value={image}>
                  {label === image ? image : `${label} (${image})`}
                </option>
              ))}
              {!choices.some(([, img]) => img === data.image) ? (
                <option value={data.image}>{data.image} (custom)</option>
              ) : null}
            </Select>
          ) : (
            <code>{choices.find(([, img]) => img === data.image)?.[0] ?? data.image}</code>
          )}
        </CardContent>
      </Card>

      {data.variables.length ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Variables</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {data.variables.map((v) => (
              <Field
                key={v.key}
                label={`${v.name} (${v.key})`}
                hint={
                  <>
                    {v.description}
                    {v.rules ? <span className="block font-mono">{v.rules}</span> : null}
                    {errors[v.key] ? <span className="block text-destructive">{errors[v.key]}</span> : null}
                  </>
                }
              >
                <Input
                  value={values[v.key] ?? ""}
                  disabled={!v.editable}
                  aria-invalid={errors[v.key] ? true : undefined}
                  onChange={(e) => setValues((x) => ({ ...x, [v.key]: e.target.value }))}
                />
              </Field>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {data.canEditVariables || data.canEditCommand ? (
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={!dirty || update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
          {dirty ? <span className="text-muted-foreground text-xs">Unsaved changes</span> : null}
        </div>
      ) : null}
    </form>
  );
}
