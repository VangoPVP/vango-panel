"use client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vango-panel/ui/components/card";
import { Input } from "@vango-panel/ui/components/input";
import { validateVariables } from "@vango-panel/wings/rules";
import { useState } from "react";
import { Field, NumberInput, Select } from "@/components/form";

import { trpc } from "@/utils/trpc";

export type Limits = {
  memoryMib: number;
  swapMib: number;
  diskMib: number;
  cpuPercent: number;
  ioWeight: number;
  threads: string;
  oomDisabled: boolean;
};

export const DEFAULT_LIMITS: Limits = {
  memoryMib: 1024,
  swapMib: 0,
  diskMib: 5120,
  cpuPercent: 100,
  ioWeight: 500,
  threads: "",
  oomDisabled: false,
};

export function LimitsCard({ value, onChange }: { value: Limits; onChange: (l: Limits) => void }) {
  const set = <K extends keyof Limits>(k: K, v: Limits[K]) => onChange({ ...value, [k]: v });
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Resources</CardTitle>
        <CardDescription>Applied when the container is (re)created, i.e. on the next start.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        <Field label="Memory (MiB)" hint="0 = unlimited">
          <NumberInput value={value.memoryMib} onChange={(v) => set("memoryMib", v)} min={0} />
        </Field>
        <Field label="Swap (MiB)" hint="-1 = unlimited">
          <NumberInput value={value.swapMib} onChange={(v) => set("swapMib", v)} min={-1} />
        </Field>
        <Field label="Disk (MiB)" hint="0 = unlimited">
          <NumberInput value={value.diskMib} onChange={(v) => set("diskMib", v)} min={0} />
        </Field>
        <Field label="CPU (%)" hint="100 = one core, 0 = unlimited">
          <NumberInput value={value.cpuPercent} onChange={(v) => set("cpuPercent", v)} min={0} />
        </Field>
        <Field label="IO weight" hint="10-1000">
          <NumberInput value={value.ioWeight} onChange={(v) => set("ioWeight", v)} min={10} max={1000} />
        </Field>
        <Field label="CPU pinning" hint="cpuset, e.g. 0-1,3 (optional)">
          <Input value={value.threads} onChange={(e) => set("threads", e.target.value)} />
        </Field>
      </CardContent>
    </Card>
  );
}

export function OwnerSelect({
  id,
  value,
  onChange,
  initialLabel,
}: {
  id?: string;
  value: string;
  onChange: (id: string) => void;
  initialLabel?: string;
}) {
  const [search, setSearch] = useState("");
  const users = useQuery(trpc.admin.users.list.queryOptions({ search }));
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      <Input placeholder="Search users…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="" disabled>
          Select owner
        </option>
        {value && !users.data?.some((u) => u.id === value) ? (
          <option value={value}>{initialLabel ?? value}</option>
        ) : null}
        {users.data?.map((u) => (
          <option key={u.id} value={u.id}>
            {u.email} ({u.name})
          </option>
        ))}
      </Select>
    </div>
  );
}

export function VariablesCard({
  variables,
  values,
  onChange,
}: {
  variables: { key: string; name: string; description?: string; default?: string; rules?: string }[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  if (!variables.length) return null;
  const errors = validateVariables(variables, values);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Variables</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {variables.map((v) => (
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
              aria-invalid={errors[v.key] ? true : undefined}
              value={values[v.key] ?? v.default ?? ""}
              onChange={(e) => onChange({ ...values, [v.key]: e.target.value })}
            />
          </Field>
        ))}
      </CardContent>
    </Card>
  );
}

const CUSTOM = "__custom__";

export function ImageSelect({
  id,
  images,
  value,
  onChange,
}: {
  id?: string;
  images: Record<string, string>;
  value: string;
  onChange: (image: string) => void;
}) {
  const known = Object.values(images);
  const [custom, setCustom] = useState(() => !!value && !known.includes(value));
  return (
    <div className="grid gap-1.5">
      <Select
        id={id}
        value={custom ? CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
          } else {
            setCustom(false);
            onChange(e.target.value);
          }
        }}
      >
        {Object.entries(images).map(([label, image]) => (
          <option key={label} value={image}>
            {label === image ? image : `${label} (${image})`}
          </option>
        ))}
        <option value={CUSTOM}>Custom…</option>
      </Select>
      {custom ? (
        <Input
          className="font-mono"
          placeholder="registry/image:tag"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
    </div>
  );
}
