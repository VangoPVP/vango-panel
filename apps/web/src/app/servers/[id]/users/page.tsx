"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vango-panel/ui/components/button";
import { Card, CardContent } from "@vango-panel/ui/components/card";
import { Checkbox } from "@vango-panel/ui/components/checkbox";
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
import { PERMISSION_GROUPS } from "@vango-panel/wings/permissions";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Field, Table } from "@/components/form";
import { type RouterOutputs, trpc } from "@/utils/trpc";

import { useServerShell } from "../server-shell";

type Data = RouterOutputs["servers"]["users"]["list"];
type Subuser = Data["subusers"][number];
type Editing = { mode: "add" } | { mode: "edit"; user: Subuser } | null;

const onError = (e: { message: string }) => toast.error(e.message);

export default function UsersPage() {
  const { server } = useServerShell();
  const qc = useQueryClient();
  const list = useQuery(trpc.servers.users.list.queryOptions({ id: server.id }));
  const [editing, setEditing] = useState<Editing>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.servers.users.list.queryKey({ id: server.id }) });
  const remove = useMutation(
    trpc.servers.users.remove.mutationOptions({
      onSuccess: () => {
        toast.success("Access removed");
        invalidate();
      },
      onError,
    }),
  );

  if (list.isPending) return <Skeleton className="h-64" />;
  if (list.isError) return <p className="text-destructive text-sm">{list.error.message}</p>;
  const d = list.data;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Subusers get access to this server only, limited to the permissions you choose. Everyone with access can view
          the console output and live stats.
        </p>
        {d.canCreate ? (
          <Button onClick={() => setEditing({ mode: "add" })}>
            <Plus /> Add user
          </Button>
        ) : null}
      </div>

      {d.subusers.length === 0 ? (
        <Card size="sm">
          <CardContent className="text-muted-foreground">No subusers yet. Only the owner and admins have access.</CardContent>
        </Card>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Permissions</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {d.subusers.map((u) => (
              <tr key={u.userId}>
                <td>
                  {u.name}
                  {u.username ? <span className="ml-1 text-muted-foreground">@{u.username}</span> : null}
                  {u.userId === d.me ? <span className="ml-1 text-muted-foreground">(you)</span> : null}
                </td>
                <td>{u.email}</td>
                <td>
                  {u.permissions.length} of {d.total}
                </td>
                <td className="whitespace-nowrap text-right">
                  {d.canUpdate && u.userId !== d.me ? (
                    <Button variant="ghost" size="xs" onClick={() => setEditing({ mode: "edit", user: u })}>
                      Edit
                    </Button>
                  ) : null}
                  {d.canDelete && u.userId !== d.me ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={remove.isPending}
                      onClick={() =>
                        confirm(`Remove ${u.name}'s access to ${server.name}? Their open console disconnects right away.`) &&
                        remove.mutate({ id: server.id, userId: u.userId })
                      }
                    >
                      Remove
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          {editing ? (
            <UserForm
              key={editing.mode === "edit" ? editing.user.userId : "add"}
              serverId={server.id}
              editing={editing}
              grantable={d.grantable}
              onDone={() => {
                setEditing(null);
                invalidate();
              }}
              onCancel={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UserForm({
  serverId,
  editing,
  grantable,
  onDone,
  onCancel,
}: {
  serverId: string;
  editing: NonNullable<Editing>;
  grantable: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [login, setLogin] = useState("");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(editing.mode === "edit" ? editing.user.permissions : []),
  );
  const add = useMutation(
    trpc.servers.users.add.mutationOptions({
      onSuccess: () => {
        toast.success("User added");
        onDone();
      },
      onError,
    }),
  );
  const update = useMutation(
    trpc.servers.users.update.mutationOptions({
      onSuccess: () => {
        toast.success("Permissions saved. Their open console reconnects with the new permissions.");
        onDone();
      },
      onError,
    }),
  );
  const pending = add.isPending || update.isPending;

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const permissions = [...selected];
        if (editing.mode === "add") add.mutate({ id: serverId, login, permissions });
        else update.mutate({ id: serverId, userId: editing.user.userId, permissions });
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing.mode === "add" ? "Add user" : `Edit ${editing.user.name}`}</DialogTitle>
        <DialogDescription>
          {editing.mode === "add"
            ? "They need a panel account already. You can only grant permissions you have yourself."
            : "You can only change permissions you have yourself."}
        </DialogDescription>
      </DialogHeader>
      {editing.mode === "add" ? (
        <Field label="Email or username">
          <Input required value={login} onChange={(e) => setLogin(e.target.value)} placeholder="name@example.com" autoFocus />
        </Field>
      ) : null}
      <PermissionEditor selected={selected} onChange={setSelected} grantable={grantable} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || (editing.mode === "add" && !login.trim())}>
          {pending ? "Saving…" : editing.mode === "add" ? "Add user" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function PermissionEditor({
  selected,
  onChange,
  grantable,
}: {
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
  grantable: string[];
}) {
  const canGrant = (p: string) => grantable.includes(p);
  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(selected);
    for (const k of keys) if (canGrant(k)) on ? next.add(k) : next.delete(k);
    onChange(next);
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {PERMISSION_GROUPS.map((g, i) => {
        const keys = g.permissions.map((p) => p.key);
        const editable = keys.filter(canGrant);
        const on = keys.filter((k) => selected.has(k)).length;
        const groupId = `perm-group-${i}`; // ids end up in aria-labelledby: no spaces/symbols
        return (
          <fieldset key={g.label} className="grid content-start gap-2 p-3 ring-1 ring-foreground/10">
            <legend className="sr-only">{g.label}</legend>
            <div className="flex items-center gap-2 border-b pb-2">
              <Checkbox
                id={groupId}
                checked={on === keys.length}
                indeterminate={on > 0 && on < keys.length}
                disabled={editable.length === 0}
                onCheckedChange={(v) => toggle(keys, v === true)}
                aria-label={`All ${g.label} permissions`}
              />
              <label htmlFor={groupId} className="font-medium text-sm">
                {g.label}
              </label>
              <span className="ml-auto text-muted-foreground text-xs">
                {on}/{keys.length}
              </span>
            </div>
            {g.permissions.map((p) => {
              const id = `perm-${p.key}`;
              const allowed = canGrant(p.key);
              return (
                <div key={p.key} className="flex items-start gap-2" title={allowed ? undefined : "You don't have this permission"}>
                  <Checkbox
                    id={id}
                    className="mt-0.5"
                    checked={selected.has(p.key)}
                    disabled={!allowed}
                    onCheckedChange={(v) => toggle([p.key], v === true)}
                  />
                  <label htmlFor={id} className={allowed ? "grid gap-0.5" : "grid gap-0.5 opacity-50"}>
                    <span className="text-xs">{p.label}</span>
                    <span className="text-muted-foreground text-xs">{p.description}</span>
                  </label>
                </div>
              );
            })}
          </fieldset>
        );
      })}
    </div>
  );
}
