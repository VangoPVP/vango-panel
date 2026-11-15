"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vango-panel/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vango-panel/ui/components/card";
import { Checkbox } from "@vango-panel/ui/components/checkbox";
import { Input } from "@vango-panel/ui/components/input";
import { Label } from "@vango-panel/ui/components/label";
import { Skeleton } from "@vango-panel/ui/components/skeleton";
import { EGG_FEATURES, FEATURE_LABELS, isEggFeature } from "@vango-panel/wings/features";
import { parseRules, validateValue } from "@vango-panel/wings/rules";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Field, PageShell, Select, Textarea } from "@/components/form";
import { type RouterInputs, trpc } from "@/utils/trpc";

type TemplateInput = RouterInputs["admin"]["templates"]["create"];
type Variable = NonNullable<TemplateInput["variables"]>[number];

const EMPTY: Required<TemplateInput> = {
  name: "",
  description: "",
  image: "",
  dockerImages: {},
  startup: "",
  stopType: "command",
  stopValue: "stop",
  startupDone: [],
  stripAnsi: true,
  configFiles: [],
  fileDenylist: [],
  installImage: "busybox:latest",
  installEntrypoint: "sh",
  installScript: "",
  variables: [],
  features: [],
};

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export default function TemplatePage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const tpl = useQuery({
    ...trpc.admin.templates.get.queryOptions({ id }),
    enabled: !isNew,
  });

  if (!isNew && tpl.isPending) return <Skeleton className="h-96" />;
  if (!isNew && tpl.isError) return <p className="text-destructive text-sm">{tpl.error.message}</p>;
  const d = tpl.data;
  const initial: Required<TemplateInput> =
    isNew || !d
      ? EMPTY
      : {
          name: d.name,
          description: d.description,
          image: d.image,
          dockerImages: d.dockerImages,
          startup: d.startup,
          stopType: d.stopType as TemplateInput["stopType"] & string,
          stopValue: d.stopValue,
          startupDone: d.startupDone,
          stripAnsi: d.stripAnsi,
          configFiles: d.configFiles as TemplateInput["configFiles"] & object,
          fileDenylist: d.fileDenylist,
          installImage: d.installImage,
          installEntrypoint: d.installEntrypoint,
          installScript: d.installScript,
          variables: d.variables,
          features: d.features.filter(isEggFeature),
        };
  return <TemplateEditor key={id} id={isNew ? null : id} initial={initial} />;
}

function TemplateEditor({ id, initial }: { id: string | null; initial: Required<TemplateInput> }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [t, setT] = useState(initial);
  const [done, setDone] = useState(initial.startupDone.join("\n"));
  const [deny, setDeny] = useState(initial.fileDenylist.join("\n"));
  const [configJson, setConfigJson] = useState(JSON.stringify(initial.configFiles, null, 2));
  const [images, setImages] = useState(() => {
    const rows = Object.entries(initial.dockerImages).map(([label, image]) => ({
      label,
      image,
    }));
    return rows.length ? rows : [{ label: "Default", image: initial.image }];
  });
  const [defaultIdx, setDefaultIdx] = useState(() =>
    Math.max(0, Object.values(initial.dockerImages).indexOf(initial.image)),
  );
  const set = <K extends keyof TemplateInput>(k: K, v: TemplateInput[K]) => setT((x) => ({ ...x, [k]: v }));

  const after = (msg: string) => () => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: trpc.admin.templates.pathKey() });
    router.push("/admin/templates");
  };
  const onError = (e: { message: string }) => toast.error(e.message);
  const create = useMutation(
    trpc.admin.templates.create.mutationOptions({
      onSuccess: after("Template created"),
      onError,
    }),
  );
  const update = useMutation(
    trpc.admin.templates.update.mutationOptions({
      onSuccess: after("Template saved"),
      onError,
    }),
  );
  const del = useMutation(
    trpc.admin.templates.delete.mutationOptions({
      onSuccess: after("Template deleted"),
      onError,
    }),
  );

  const submit = () => {
    let configFiles: TemplateInput["configFiles"];
    try {
      configFiles = JSON.parse(configJson || "[]");
    } catch {
      toast.error("Config files must be valid JSON");
      return;
    }
    const rows = images.map((r) => ({ label: r.label.trim(), image: r.image.trim() })).filter((r) => r.image);
    if (!rows.length) {
      toast.error("Add at least one docker image");
      return;
    }
    if (new Set(rows.map((r) => r.label || r.image)).size !== rows.length) {
      toast.error("Image labels must be unique");
      return;
    }
    const dockerImages = Object.fromEntries(rows.map((r) => [r.label || r.image, r.image]));
    const image = (rows[defaultIdx] ?? rows[0])?.image ?? "";
    const body = {
      ...t,
      image,
      dockerImages,
      startupDone: lines(done),
      fileDenylist: lines(deny),
      configFiles,
    };
    if (id) update.mutate({ id, template: body });
    else create.mutate(body);
  };

  const setVar = (i: number, patch: Partial<Variable>) =>
    set(
      "variables",
      t.variables.map((v, j) => (j === i ? { ...v, ...patch } : v)),
    );

  return (
    <PageShell
      title={id ? `Template: ${initial.name}` : "New template"}
      actions={
        <>
          {id ? (
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={() => confirm("Delete this template?") && del.mutate({ id })}
            >
              Delete
            </Button>
          ) : null}
          <Button onClick={submit} disabled={create.isPending || update.isPending}>
            {id ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <Card size="sm">
        <CardHeader>
          <CardTitle>Runtime</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={t.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Input value={t.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <Field
            label="Startup command"
            className="sm:col-span-2"
            hint={
              <>
                <code>{"{{VAR}}"}</code> is replaced with variable values, plus <code>{"{{SERVER_MEMORY}}"}</code>,{" "}
                <code>{"{{SERVER_IP}}"}</code>, <code>{"{{SERVER_PORT}}"}</code>.
              </>
            }
          >
            <Textarea value={t.startup} onChange={(e) => set("startup", e.target.value)} className="min-h-16" />
          </Field>
          <Field label="Stop type">
            <Select value={t.stopType} onChange={(e) => set("stopType", e.target.value as TemplateInput["stopType"])}>
              <option value="command">command (write to console)</option>
              <option value="signal">signal (e.g. SIGINT)</option>
              <option value="stop">docker stop</option>
            </Select>
          </Field>
          <Field label="Stop value">
            <Input
              value={t.stopValue}
              onChange={(e) => set("stopValue", e.target.value)}
              disabled={t.stopType === "stop"}
            />
          </Field>
          <Field label="Started when console contains" hint="One per line, e.g. Done (">
            <Textarea value={done} onChange={(e) => setDone(e.target.value)} className="min-h-16" />
          </Field>
          <Field label="File denylist" hint="gitignore-style patterns users can't touch">
            <Textarea value={deny} onChange={(e) => setDeny(e.target.value)} className="min-h-16" />
          </Field>
          <div className="flex items-center gap-2">
            <Checkbox id="strip" checked={t.stripAnsi} onCheckedChange={(v) => set("stripAnsi", v === true)} />
            <Label htmlFor="strip">Strip ANSI before matching startup lines</Label>
          </div>
          <Field
            label="Console helpers"
            className="sm:col-span-2"
            hint="Watch the console for known problems and offer users a fix (as in Pterodactyl eggs)."
          >
            <div className="flex flex-wrap gap-4">
              {EGG_FEATURES.map((f) => (
                <span key={f} className="flex items-center gap-2">
                  <Checkbox
                    id={`feature-${f}`}
                    checked={t.features.includes(f)}
                    onCheckedChange={(c) =>
                      set("features", c === true ? [...t.features, f] : t.features.filter((x) => x !== f))
                    }
                  />
                  <Label htmlFor={`feature-${f}`}>{FEATURE_LABELS[f]}</Label>
                </span>
              ))}
            </div>
          </Field>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Docker images</CardTitle>
          <CardDescription>Choices offered when creating a server. The selected one is the default.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {images.map((row, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[auto_12rem_1fr_auto]">
              <label className="flex h-8 items-center gap-1.5" title="Default image">
                <input type="radio" name="default-image" checked={defaultIdx === i} onChange={() => setDefaultIdx(i)} />
                <span className="text-muted-foreground">Default</span>
              </label>
              <Field label="Label">
                <Input
                  value={row.label}
                  placeholder="Java 21"
                  onChange={(e) => setImages((rs) => rs.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
                />
              </Field>
              <Field label="Image">
                <Input
                  className="font-mono"
                  value={row.image}
                  placeholder="ghcr.io/pterodactyl/yolks:java_21"
                  onChange={(e) => setImages((rs) => rs.map((r, j) => (j === i ? { ...r, image: e.target.value } : r)))}
                />
              </Field>
              <Button
                variant="ghost"
                size="sm"
                disabled={images.length === 1}
                onClick={() => {
                  setImages((rs) => rs.filter((_, j) => j !== i));
                  setDefaultIdx((d) => (d === i ? 0 : d > i ? d - 1 : d));
                }}
              >
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button variant="outline" size="sm" onClick={() => setImages((rs) => [...rs, { label: "", image: "" }])}>
              Add image
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Variables</CardTitle>
          <CardDescription>Passed to the container as environment variables.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {t.variables.map((v, i) => (
            <div key={i} className="grid gap-2 p-2 ring-1 ring-foreground/10">
              <div className="grid items-end gap-2 sm:grid-cols-[10rem_1fr_1fr_auto_auto]">
                <Field label="Key">
                  <Input
                    value={v.key}
                    onChange={(e) => setVar(i, { key: e.target.value.toUpperCase() })}
                    className="font-mono"
                  />
                </Field>
                <Field label="Name">
                  <Input value={v.name} onChange={(e) => setVar(i, { name: e.target.value })} />
                </Field>
                <Field label="Default">
                  <Input value={v.default ?? ""} onChange={(e) => setVar(i, { default: e.target.value })} />
                </Field>
                <div className="flex h-8 items-center gap-2">
                  <Checkbox
                    checked={v.userEditable ?? false}
                    onCheckedChange={(c) => setVar(i, { userEditable: c === true })}
                  />
                  <span>User editable</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    set(
                      "variables",
                      t.variables.filter((_, j) => j !== i),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
              <RulesField
                rules={v.rules ?? ""}
                defaultValue={v.default ?? ""}
                onChange={(rules) => setVar(i, { rules })}
              />
            </div>
          ))}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                set("variables", [
                  ...t.variables,
                  {
                    key: "",
                    name: "",
                    description: "",
                    default: "",
                    userEditable: false,
                    rules: "",
                  },
                ])
              }
            >
              Add variable
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Installation</CardTitle>
          <CardDescription>
            Runs once in a separate container. The server files are at <code>/mnt/server</code>. Leave the script empty
            to skip installation.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Install image">
            <Input value={t.installImage} onChange={(e) => set("installImage", e.target.value)} />
          </Field>
          <Field label="Entrypoint">
            <Input value={t.installEntrypoint} onChange={(e) => set("installEntrypoint", e.target.value)} />
          </Field>
          <Field label="Script" className="sm:col-span-2">
            <Textarea
              value={t.installScript}
              onChange={(e) => set("installScript", e.target.value)}
              className="min-h-40"
            />
          </Field>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Config files</CardTitle>
          <CardDescription>
            Rewritten by wings before each start. JSON array of{" "}
            <code>{'{"file", "parser", "replace": [{"match", "replace_with"}]}'}</code>. Parsers: properties, file,
            yaml, json, toml, ini, xml.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={configJson}
            onChange={(e) => setConfigJson(e.target.value)}
            className="min-h-32"
            placeholder={
              '[{"file":"server.properties","parser":"properties","replace":[{"match":"server-port","replace_with":"{{server.build.default.port}}"}]}]'
            }
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}

function RulesField({
  rules,
  defaultValue,
  onChange,
}: {
  rules: string;
  defaultValue: string;
  onChange: (rules: string) => void;
}) {
  const parsed = parseRules(rules);
  const problems = [
    ...parsed.unsupported.map((r) => `"${r}" isn't supported and won't be checked`),
    ...parsed.invalid.map((r) => `${r} can't be used and won't be checked`),
  ];
  const defaultError = rules ? validateValue("The default", defaultValue, parsed) : null;
  return (
    <Field
      label="Validation rules"
      hint={
        <>
          Laravel-style, e.g. <code>required|string|max:20</code> or <code>{"nullable|regex:/^[a-z]+$/"}</code>.
          {problems.length ? (
            <span className="block text-yellow-700 dark:text-yellow-400">{problems.join("; ")}.</span>
          ) : null}
          {defaultError ? <span className="block text-yellow-700 dark:text-yellow-400">{defaultError}</span> : null}
        </>
      }
    >
      <Input
        className="font-mono"
        value={rules}
        onChange={(e) => onChange(e.target.value)}
        placeholder="nullable|string"
      />
    </Field>
  );
}
