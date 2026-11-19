"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isSuperAdmin } from "@vango-panel/auth/roles";
import { usernameError } from "@vango-panel/auth/username";
import { Button, buttonVariants } from "@vango-panel/ui/components/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@vango-panel/ui/components/card";
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
import { Copy } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Field, PageShell, Select, Table } from "@/components/form";
import { type RouterOutputs, trpc } from "@/utils/trpc";

import { OwnerSelect } from "../../servers/server-form";
import { RoleLabel } from "../role-label";

type User = RouterOutputs["admin"]["users"]["get"];

const SELF_HINT = "Use your Account page for your own account.";

export default function AdminUserPage() {
  const { id } = useParams<{ id: string }>();
  const user = useQuery(trpc.admin.users.get.queryOptions({ userId: id }));
  if (user.isPending) return <Skeleton className="h-96" />;
  if (user.isError) return <p className="text-destructive text-sm">{user.error.message}</p>;
  return <UserDetail key={user.data.updatedAt.toString()} user={user.data} />;
}

function when(d: Date | string | null | undefined) {
  return d ? new Date(d).toLocaleString() : "–";
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: trpc.admin.users.pathKey() });
}

const onError = (e: { message: string }) => toast.error(e.message);

function UserDetail({ user: u }: { user: User }) {
  return (
    <PageShell
      title={
        <span className="flex items-center gap-3">
          {u.name}
          {u.self ? <span className="font-normal text-muted-foreground text-sm">(you)</span> : null}
        </span>
      }
      description={
        <>
          {u.username ? `@${u.username} · ` : null}
          {u.email} · joined {new Date(u.createdAt).toLocaleDateString()} · <RoleLabel role={u.role} />
        </>
      }
      actions={
        <Link className={buttonVariants({ variant: "outline" })} href={"/admin/users" as Route}>
          All users
        </Link>
      }
    >
      {u.locked ? (
        <p className="border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">{u.locked}. You can only view it.</p>
      ) : null}
      <ProfileCard user={u} />
      <SecurityCard user={u} />
      <AccessCard user={u} />
      <SshKeysCard user={u} />
      <ActivityCard user={u} />
      <DangerCard user={u} />
    </PageShell>
  );
}

function ProfileCard({ user: u }: { user: User }) {
  const invalidate = useInvalidate();
  const [name, setName] = useState(u.name);
  const [email, setEmail] = useState(u.email);
  const [username, setUsername] = useState(u.displayUsername ?? u.username ?? "");
  const disabled = !!u.locked;
  const usernameErr = username ? usernameError(username) : null;

  const update = useMutation(
    trpc.admin.users.update.mutationOptions({
      onSuccess: () => {
        toast.success("Profile saved");
        invalidate();
      },
      onError,
    }),
  );
  const rename = useMutation(
    trpc.admin.users.setUsername.mutationOptions({
      onSuccess: (r) => {
        toast.success(`Renamed to @${r.username}`);
        invalidate();
      },
      onError,
    }),
  );
  const setRole = useMutation(
    trpc.admin.users.setRole.mutationOptions({
      onSuccess: () => {
        toast.success("Role updated");
        invalidate();
      },
      onError,
    }),
  );

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form
          className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ userId: u.id, name, email });
          }}
        >
          <Field label="Name">
            <Input value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} disabled={disabled} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Button
            type="submit"
            variant="outline"
            disabled={disabled || update.isPending || (name === u.name && email === u.email)}
          >
            Save
          </Button>
        </form>
        <form
          className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!usernameErr && username.trim()) rename.mutate({ userId: u.id, username: username.trim() });
          }}
        >
          <Field
            label="Username"
            hint={usernameErr ? <span className="text-destructive">{usernameErr}</span> : "Also their SFTP login."}
          >
            <Input value={username} disabled={disabled} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Role">
            {isSuperAdmin(u.role) ? (
              <div className="py-1.5 text-xs">
                <RoleLabel role={u.role} />
              </div>
            ) : (
              <Select
                value={u.role}
                disabled={disabled || setRole.isPending}
                onChange={(e) => {
                  const role = e.target.value as "admin" | "user";
                  if (u.self && role === "user" && !confirm("Remove your own admin access?")) {
                    e.target.value = u.role;
                    return;
                  }
                  setRole.mutate({ userId: u.id, role });
                }}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </Select>
            )}
          </Field>
          <Button
            type="submit"
            variant="outline"
            disabled={
              disabled ||
              rename.isPending ||
              !!usernameErr ||
              !username.trim() ||
              username.trim() === (u.displayUsername ?? u.username)
            }
          >
            Rename
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SecurityCard({ user: u }: { user: User }) {
  const invalidate = useInvalidate();
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const blocked = u.self || !!u.locked;
  const blockedTitle = u.self ? SELF_HINT : (u.locked ?? undefined);

  const resetPassword = useMutation(
    trpc.admin.users.resetPassword.mutationOptions({
      onSuccess: (r) => {
        setTempPassword(r.password);
        invalidate();
      },
      onError,
    }),
  );
  const reset2fa = useMutation(
    trpc.admin.users.resetTwoFactor.mutationOptions({
      onSuccess: () => {
        toast.success("2FA reset and the user was signed out everywhere");
        invalidate();
      },
      onError,
    }),
  );
  const revoke = useMutation(
    trpc.admin.users.revokeSessions.mutationOptions({
      onSuccess: (r) => {
        toast.success(r.sessions ? `Signed out of ${r.sessions} session(s)` : "No active sessions; console access revoked");
        invalidate();
      },
      onError,
    }),
  );

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>Resetting the password or 2FA also signs them out everywhere.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs">
            <div className="font-medium">Password</div>
            <div className="text-muted-foreground">{u.hasPassword ? "Set" : "No password set"}</div>
          </div>
          <Button
            variant="outline"
            disabled={blocked || resetPassword.isPending}
            title={blockedTitle}
            onClick={() =>
              confirm(
                `Reset the password for ${u.name}? A new password is generated for you to give them, and they're signed out everywhere.`,
              ) && resetPassword.mutate({ userId: u.id })
            }
          >
            Reset password
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs">
            <div className="font-medium">Two-factor authentication</div>
            {u.twoFactorEnabled ? (
              <div className="text-green-600 dark:text-green-400">On</div>
            ) : (
              <div className="text-muted-foreground">Off</div>
            )}
          </div>
          {u.twoFactorEnabled ? (
            <Button
              variant="outline"
              disabled={blocked || reset2fa.isPending}
              title={blockedTitle ?? "For a lost phone: removes their 2FA and signs them out everywhere"}
              onClick={() =>
                confirm(
                  `Reset 2FA for ${u.name}? Their authenticator and backup codes stop working and they're signed out everywhere.`,
                ) && reset2fa.mutate({ userId: u.id })
              }
            >
              Reset 2FA
            </Button>
          ) : null}
        </div>

        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium text-xs">Active sessions ({u.sessions.length})</div>
            <Button
              variant="outline"
              disabled={blocked || revoke.isPending}
              title={blockedTitle}
              onClick={() =>
                confirm(`Sign ${u.name} out everywhere? Open consoles are disconnected too.`) &&
                revoke.mutate({ userId: u.id })
              }
            >
              Sign out everywhere
            </Button>
          </div>
          {u.sessions.length ? (
            <Table>
              <thead>
                <tr>
                  <th>Signed in</th>
                  <th>Last active</th>
                  <th>IP</th>
                  <th>Device</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {u.sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{when(s.createdAt)}</td>
                    <td>{when(s.updatedAt)}</td>
                    <td className="font-mono">{s.ipAddress || "–"}</td>
                    <td className="max-w-72 truncate" title={s.userAgent ?? undefined}>
                      {s.userAgent || "–"}
                    </td>
                    <td>{when(s.expiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
        </div>
      </CardContent>

      <Dialog open={tempPassword !== null} onOpenChange={(o) => !o && setTempPassword(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New password for {u.name}</DialogTitle>
            <DialogDescription>
              Give this to them over a private channel. It's shown only once. They've been signed out everywhere
              {u.twoFactorEnabled ? " and still need their 2FA code to sign in" : ""}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={tempPassword ?? ""} className="font-mono" onFocus={(e) => e.target.select()} />
            <Button
              variant="outline"
              onClick={() =>
                tempPassword && navigator.clipboard.writeText(tempPassword).then(() => toast.success("Copied"))
              }
            >
              <Copy /> Copy
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setTempPassword(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AccessCard({ user: u }: { user: User }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Server access</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <div className="font-medium text-xs">Owns ({u.ownedServers.length})</div>
          {u.ownedServers.length ? (
            <Table>
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Node</th>
                </tr>
              </thead>
              <tbody>
                {u.ownedServers.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link className="underline" href={`/admin/servers/${s.id}` as Route}>
                        {s.name}
                      </Link>
                    </td>
                    <td>
                      <Link className="underline" href={`/admin/nodes/${s.node.id}` as Route}>
                        {s.node.name}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-xs">No servers.</p>
          )}
        </div>
        <div className="grid gap-2">
          <div className="font-medium text-xs">Subuser on ({u.subuserOf.length})</div>
          {u.subuserOf.length ? (
            <Table>
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Owner</th>
                  <th>Permissions</th>
                </tr>
              </thead>
              <tbody>
                {u.subuserOf.map((r) => (
                  <tr key={r.server.id}>
                    <td>
                      <Link className="underline" href={`/admin/servers/${r.server.id}` as Route}>
                        {r.server.name}
                      </Link>
                    </td>
                    <td>
                      <Link className="underline" href={`/admin/users/${r.server.owner.id}` as Route}>
                        {r.server.owner.email}
                      </Link>
                    </td>
                    <td>{r.permissions.length}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-xs">Not a subuser anywhere.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SshKeysCard({ user: u }: { user: User }) {
  const invalidate = useInvalidate();
  const del = useMutation(
    trpc.admin.users.deleteSshKey.mutationOptions({
      onSuccess: () => {
        toast.success("SSH key removed");
        invalidate();
      },
      onError,
    }),
  );
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>SSH keys</CardTitle>
        <CardDescription>Used for SFTP logins.</CardDescription>
      </CardHeader>
      <CardContent>
        {u.sshKeys.length ? (
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Fingerprint</th>
                <th>Added</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {u.sshKeys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td className="font-mono" title={k.type}>
                    {k.fingerprint}
                  </td>
                  <td>{when(k.createdAt)}</td>
                  <td>{when(k.lastUsedAt)}</td>
                  <td className="text-right">
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={!!u.locked || del.isPending}
                      onClick={() =>
                        confirm(`Remove the SSH key "${k.name}"? SFTP logins with it stop working.`) &&
                        del.mutate({ userId: u.id, keyId: k.id })
                      }
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="text-muted-foreground text-xs">No SSH keys.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityCard({ user: u }: { user: User }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Their actions and admin actions on their account (last 25).</CardDescription>
      </CardHeader>
      <CardContent>
        {u.activity.length ? (
          <Table>
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>By</th>
                <th>Server</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {u.activity.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap">{when(a.timestamp)}</td>
                  <td className="font-mono">{a.event}</td>
                  <td>{a.userId === u.id ? "them" : a.userId ? "admin" : "system"}</td>
                  <td>
                    {a.serverId ? (
                      <Link className="font-mono underline" href={`/admin/servers/${a.serverId}` as Route}>
                        {a.serverId.slice(0, 8)}
                      </Link>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td className="font-mono">{a.ip || "–"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="text-muted-foreground text-xs">No activity yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function DangerCard({ user: u }: { user: User }) {
  const [open, setOpen] = useState(false);
  const blocked = u.self || !!u.locked;
  return (
    <Card size="sm" className="border-destructive/40">
      <CardHeader>
        <CardTitle>Delete user</CardTitle>
        <CardDescription>
          Removes the account, its sessions, 2FA, SSH keys and subuser access. Servers they own move to someone you
          choose; nothing on the nodes changes.
        </CardDescription>
        <CardAction>
          <Button
            variant="destructive"
            disabled={blocked}
            title={u.self ? "You can't delete your own account here" : (u.locked ?? undefined)}
            onClick={() => setOpen(true)}
          >
            Delete user
          </Button>
        </CardAction>
      </CardHeader>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>{open ? <DeleteUser user={u} close={() => setOpen(false)} /> : null}</DialogContent>
      </Dialog>
    </Card>
  );
}

function DeleteUser({ user: u, close }: { user: User; close: () => void }) {
  const router = useRouter();
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  const [transferTo, setTransferTo] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const confirmWord = u.username ?? u.email;
  const owns = u.ownedServers.length;
  const transferInvalid = owns > 0 && (!transferTo || transferTo === u.id);

  const del = useMutation(
    trpc.admin.users.delete.mutationOptions({
      onSuccess: (r) => {
        toast.success(r.transferred ? `User deleted; ${r.transferred} server(s) transferred` : "User deleted");
        invalidate();
        qc.invalidateQueries({ queryKey: trpc.admin.servers.pathKey() });
        close();
        router.push("/admin/users" as Route);
      },
      onError,
    }),
  );

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (transferInvalid || confirmText !== confirmWord) return;
        del.mutate({ userId: u.id, transferTo: owns ? transferTo : undefined });
      }}
    >
      <DialogHeader>
        <DialogTitle>Delete {u.name}?</DialogTitle>
        <DialogDescription>
          This can't be undone. They're signed out and lose all access immediately.
        </DialogDescription>
      </DialogHeader>
      {owns ? (
        <Field
          label={`New owner for ${owns} server(s)`}
          hint={
            transferTo === u.id ? (
              <span className="text-destructive">Choose someone other than the user being deleted.</span>
            ) : (
              u.ownedServers.map((s) => s.name).join(", ")
            )
          }
        >
          <OwnerSelect value={transferTo} onChange={setTransferTo} />
        </Field>
      ) : null}
      <Field label={`Type ${confirmWord} to confirm`}>
        <Input autoFocus value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="destructive"
          disabled={del.isPending || transferInvalid || confirmText !== confirmWord}
        >
          Delete user
        </Button>
      </DialogFooter>
    </form>
  );
}
