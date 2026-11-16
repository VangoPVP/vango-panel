"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vango-panel/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vango-panel/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vango-panel/ui/components/dialog";
import { Input } from "@vango-panel/ui/components/input";
import { Skeleton } from "@vango-panel/ui/components/skeleton";
import { isLoopbackIp, isWildcardIp } from "@vango-panel/wings/allocations";
import { databaseNameFor, databaseSuffixError } from "@vango-panel/wings/databases";
import { Copy, Eye, EyeOff, KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Field } from "@/components/form";
import { type RouterOutputs, trpc } from "@/utils/trpc";

import { Banner, useServerShell } from "../server-shell";

type Data = RouterOutputs["servers"]["databases"]["list"];
type Database = Data["databases"][number];

const copy = (text: string, what = "Copied") => navigator.clipboard.writeText(text).then(() => toast.success(what));

export default function DatabasesPage() {
  const { server, refresh } = useServerShell();
  const qc = useQueryClient();
  const list = useQuery(trpc.servers.databases.list.queryOptions({ id: server.id }));
  const [creating, setCreating] = useState(false);
  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: trpc.servers.databases.list.queryKey({ id: server.id }) });
    await refresh();
  };

  if (list.isPending) return <Skeleton className="h-64" />;
  if (list.isError) return <p className="text-destructive text-sm">{list.error.message}</p>;
  const d = list.data;
  const full = d.databases.length >= d.limit;
  const unreachable = d.databases.some((db) => isLoopbackIp(db.host) || isWildcardIp(db.host));

  return (
    <div className="grid gap-4">
      {unreachable ? (
        <Banner tone="error">
          The database host is configured as a loopback address, which your server can't reach from inside its container.
          An administrator needs to set "Servers connect to" under Admin → Databases (e.g. 192.168.2.108).
        </Banner>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {d.databases.length} of {d.limit} database{d.limit === 1 ? "" : "s"} used. Connect from your server using the
          host below, not <code>localhost</code>: inside the container, localhost is the container itself.
        </p>
        {d.canCreate ? (
          <Button onClick={() => setCreating(true)} disabled={full} title={full ? "Database limit reached" : undefined}>
            <Plus /> New database
          </Button>
        ) : null}
      </div>

      {d.databases.length === 0 ? (
        <Card size="sm">
          <CardContent className="text-muted-foreground">No databases yet.</CardContent>
        </Card>
      ) : (
        d.databases.map((db) => <DatabaseCard key={db.id} db={db} data={d} onChanged={invalidate} />)
      )}

      <CreateDialog open={creating} onClose={() => setCreating(false)} serverId={server.id} onCreated={invalidate} />
    </div>
  );
}

function DatabaseCard({ db, data, onChanged }: { db: Database; data: Data; onChanged: () => Promise<void> }) {
  const { server } = useServerShell();
  const [showPassword, setShowPassword] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const onError = (e: { message: string }) => toast.error(e.message);
  const rotate = useMutation(
    trpc.servers.databases.rotatePassword.mutationOptions({
      onSuccess: async () => {
        toast.success("Password rotated. Update your server's config and restart it.");
        await onChanged();
      },
      onError,
    }),
  );
  const del = useMutation(
    trpc.servers.databases.delete.mutationOptions({
      onSuccess: async () => {
        toast.success(`Deleted ${db.name}`);
        setConfirmDelete(false);
        await onChanged();
      },
      onError,
    }),
  );

  const rows: [string, string][] = [
    ["Host", `${db.host}:${db.port}`],
    ["Database", db.name],
    ["Username", db.username],
  ];

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="font-mono">{db.name}</CardTitle>
          <CardDescription>Connections allowed from {db.remotes.join(", ")}</CardDescription>
        </div>
        <div className="flex gap-1">
          {data.canUpdate ? (
            <Button
              variant="outline"
              size="sm"
              disabled={rotate.isPending}
              onClick={() =>
                confirm("Generate a new password? The old one stops working immediately.") &&
                rotate.mutate({ id: server.id, databaseId: db.id })
              }
            >
              <KeyRound /> Rotate password
            </Button>
          ) : null}
          {data.canDelete ? (
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)} aria-label={`Delete ${db.name}`}>
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 font-mono">
          {rows.map(([label, value]) => (
            <Row key={label} label={label} value={value} />
          ))}
          {db.password !== null ? (
            <>
              <dt className="text-muted-foreground">Password</dt>
              <dd className="truncate">{showPassword ? db.password : "••••••••••••••••"}</dd>
              <dd className="flex">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </Button>
                <Button variant="ghost" size="xs" onClick={() => copy(db.password ?? "")} aria-label="Copy password">
                  <Copy />
                </Button>
              </dd>
            </>
          ) : null}
          <Row label="JDBC URL" value={db.jdbc} />
        </dl>
      </CardContent>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {db.name}?</DialogTitle>
            <DialogDescription>The database, all its tables and its user are permanently removed.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={() => del.mutate({ id: server.id, databaseId: db.id })}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate" title={value}>
        {value}
      </dd>
      <dd>
        <Button variant="ghost" size="xs" onClick={() => copy(value)} aria-label={`Copy ${label}`}>
          <Copy />
        </Button>
      </dd>
    </>
  );
}

function CreateDialog({
  open,
  onClose,
  serverId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  serverId: string;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const create = useMutation(
    trpc.servers.databases.create.mutationOptions({
      onSuccess: async () => {
        toast.success("Database created");
        setName("");
        onClose();
        await onCreated();
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const error = name ? databaseSuffixError(name) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!databaseSuffixError(name)) create.mutate({ id: serverId, name });
          }}
        >
          <DialogHeader>
            <DialogTitle>New database</DialogTitle>
            <DialogDescription>A user with a random password is created with access to this database only.</DialogDescription>
          </DialogHeader>
          <Field
            label="Name"
            hint={
              error ? (
                <span className="text-destructive">{error}</span>
              ) : name ? (
                <>
                  Created as <code>{databaseNameFor(serverId, name)}</code>
                </>
              ) : (
                "a-z, 0-9 and _"
              )
            }
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="luckperms"
              aria-invalid={error ? true : undefined}
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !name || !!error}>
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
