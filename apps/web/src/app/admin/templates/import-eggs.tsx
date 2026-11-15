"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vango-panel/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vango-panel/ui/components/card";
import { cn } from "@vango-panel/ui/lib/utils";
import { type EggImportResult, eggToTemplate } from "@vango-panel/wings/egg";
import { useState } from "react";
import { toast } from "sonner";

import { Select, Textarea } from "@/components/form";
import { trpc } from "@/utils/trpc";

type Item = {
  key: number;
  source: string;
  egg: unknown;
  preview: EggImportResult;
  onConflict: "update" | "copy";
  status: "pending" | "importing" | "done" | "failed";
  message?: string;
};

const MAX_BYTES = 2 * 1024 * 1024;

function toItem(key: number, source: string, text: string): Item {
  let egg: unknown;
  try {
    egg = JSON.parse(text);
  } catch {
    return { key, source, egg: null, preview: { ok: false, error: "Not valid JSON" }, onConflict: "copy", status: "pending" };
  }
  return { key, source, egg, preview: eggToTemplate(egg), onConflict: "copy", status: "pending" };
}

export function ImportEggs({ existingNames, onDone }: { existingNames: string[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [paste, setPaste] = useState("");
  const [nextKey, setNextKey] = useState(0);
  const importEgg = useMutation(trpc.admin.templates.importEgg.mutationOptions());
  const taken = new Set(existingNames);

  const add = (entries: { source: string; text: string }[]) => {
    setItems((cur) => [...cur, ...entries.map((e, i) => toItem(nextKey + i, e.source, e.text))]);
    setNextKey((k) => k + entries.length);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const entries: { source: string; text: string }[] = [];
    for (const f of Array.from(files)) {
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name} is larger than 2 MiB`);
        continue;
      }
      entries.push({ source: f.name, text: await f.text() });
    }
    add(entries);
  };

  const update = (key: number, patch: Partial<Item>) =>
    setItems((cur) => cur.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  const ready = items.filter((it) => it.preview.ok && it.status !== "done");

  const runImport = async () => {
    let ok = 0;
    for (const it of ready) {
      update(it.key, { status: "importing", message: undefined });
      try {
        const r = await importEgg.mutateAsync({ egg: it.egg, onConflict: it.onConflict });
        ok++;
        update(it.key, { status: "done", message: `${r.action === "updated" ? "Updated" : "Created"} "${r.name}"` });
      } catch (e) {
        update(it.key, { status: "failed", message: e instanceof Error ? e.message : "Import failed" });
      }
    }
    await qc.invalidateQueries({ queryKey: trpc.admin.templates.pathKey() });
    if (ok) toast.success(`Imported ${ok} egg${ok === 1 ? "" : "s"}`);
  };

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Import eggs</CardTitle>
        <CardDescription>
          Pterodactyl egg JSON exports (PTDL_v1/v2). Each egg becomes a template; check the warnings before importing.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid cursor-pointer place-items-center gap-1 p-6 text-center ring-1 ring-dashed ring-foreground/20 hover:bg-muted">
            <span className="font-medium">Choose egg files</span>
            <span className="text-muted-foreground">.json, several at once</span>
            <input
              type="file"
              accept=".json,application/json"
              multiple
              className="sr-only"
              onChange={(e) => {
                void onFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <div className="grid gap-2">
            <Textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="…or paste egg JSON here"
              className="min-h-20"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!paste.trim()}
              onClick={() => {
                add([{ source: "pasted", text: paste }]);
                setPaste("");
              }}
            >
              Add pasted egg
            </Button>
          </div>
        </div>

        {items.map((it) => {
          const p = it.preview;
          const conflict = p.ok && taken.has(p.template.name);
          return (
            <div
              key={it.key}
              className={cn(
                "grid gap-1.5 p-3 ring-1",
                !p.ok || it.status === "failed" ? "ring-destructive/40" : it.status === "done" ? "ring-green-600/40" : "ring-foreground/10",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium">{p.ok ? p.template.name : it.source}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {it.source}
                    {p.ok && p.version ? ` · ${p.version}` : ""}
                    {p.ok && p.author ? ` · by ${p.author}` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {conflict && it.status !== "done" ? (
                    <Select
                      className="w-56"
                      value={it.onConflict}
                      onChange={(e) => update(it.key, { onConflict: e.target.value as Item["onConflict"] })}
                      disabled={it.status === "importing"}
                    >
                      <option value="copy">Name exists: import as copy</option>
                      <option value="update">Name exists: update existing</option>
                    </Select>
                  ) : null}
                  {it.status !== "done" ? (
                    <Button variant="ghost" size="xs" onClick={() => setItems((cur) => cur.filter((x) => x.key !== it.key))}>
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
              {p.ok ? (
                <>
                  <div className="text-muted-foreground">
                    {Object.keys(p.template.dockerImages).length} image(s): {Object.keys(p.template.dockerImages).join(", ")}
                    {" · "}
                    {p.template.variables.length} variable(s) · {p.template.configFiles.length} config file(s) · stop:{" "}
                    {p.template.stopType === "stop" ? "docker stop" : `${p.template.stopType} ${p.template.stopValue}`}
                    {" · "}
                    {p.template.installScript.trim() ? "has install script" : "no install script"}
                    {p.template.features.length ? ` · console helpers: ${p.template.features.join(", ")}` : ""}
                  </div>
                  {p.warnings.length ? (
                    <ul className="list-inside list-disc text-yellow-700 dark:text-yellow-400">
                      {p.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  ) : null}
                  {conflict && it.onConflict === "update" && it.status !== "done" ? (
                    <p className="text-muted-foreground">
                      Replaces the existing template. Servers using it pick up the change on their next start.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-destructive">{p.error}</p>
              )}
              {it.message ? (
                <p className={it.status === "failed" ? "text-destructive" : "text-green-700 dark:text-green-400"}>
                  {it.message}
                </p>
              ) : null}
            </div>
          );
        })}

        <div className="flex gap-2">
          <Button disabled={!ready.length || importEgg.isPending} onClick={() => void runImport()}>
            {importEgg.isPending ? "Importing…" : `Import ${ready.length || ""} egg${ready.length === 1 ? "" : "s"}`}
          </Button>
          <Button variant="outline" onClick={onDone}>
            Close
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
