"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeUsername, usernameError } from "@vango-panel/auth/username";
import { Button } from "@vango-panel/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vango-panel/ui/components/card";
import { Input } from "@vango-panel/ui/components/input";
import { Skeleton } from "@vango-panel/ui/components/skeleton";
import { parseSshPublicKey, sshFingerprint } from "@vango-panel/wings/ssh";
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Field, PageShell, Table, Textarea } from "@/components/form";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

import { TwoFactorCard } from "./two-factor-card";

export default function AccountView({ twoFactor }: { twoFactor: { required: boolean; mustSetUp: boolean } }) {
  const { data: session, isPending, refetch } = authClient.useSession();
  if (isPending || !session) return <Skeleton className="h-96" />;
  return (
    <PageShell title="Account" description={session.user.email}>
      {twoFactor.mustSetUp ? (
        <div className="bg-yellow-500/10 px-3 py-2 text-xs ring-1 ring-yellow-500/30">
          Your role requires two-factor authentication. Set it up below to continue using the panel.
        </div>
      ) : null}
      <TwoFactorCard
        enabled={!!session.user.twoFactorEnabled}
        required={twoFactor.required}
        mustSetUp={twoFactor.mustSetUp}
        onChanged={() => refetch()}
      />
      <UsernameCard current={session.user.displayUsername ?? session.user.username ?? ""} />
      <SshKeysCard />
      <PasswordCard />
    </PageShell>
  );
}

function UsernameCard({ current }: { current: string }) {
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);
  const error = value ? usernameError(value) : null;
  const changed = normalizeUsername(value) !== normalizeUsername(current) || value.trim() !== current;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Username</CardTitle>
        <CardDescription>
          Sign in with it instead of your email. It's also your SFTP login, so changing it changes how you connect.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-start gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (error || !changed) return;
            setSaving(true);
            const { error: err } = await authClient.updateUser({ username: value.trim() });
            setSaving(false);
            if (err) toast.error(err.message ?? "Couldn't change the username");
            else toast.success("Username changed");
          }}
        >
          <Field label="Username" className="w-72" hint={error ? <span className="text-destructive">{error}</span> : undefined}>
            <Input value={value} onChange={(e) => setValue(e.target.value)} autoComplete="username" />
          </Field>
          <Button type="submit" className="mt-5" disabled={!!error || !changed || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SshKeysCard() {
  const qc = useQueryClient();
  const keys = useQuery(trpc.account.sshKeys.list.queryOptions());
  const [name, setName] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [preview, setPreview] = useState<{ fingerprint?: string; error?: string; label?: string } | null>(null);

  useEffect(() => {
    if (!publicKey.trim()) {
      setPreview(null);
      return;
    }
    const parsed = parseSshPublicKey(publicKey);
    if (!parsed.ok) {
      setPreview({ error: parsed.error });
      return;
    }
    let cancelled = false;
    void sshFingerprint(parsed.key.blob).then((fingerprint) => {
      if (!cancelled) setPreview({ fingerprint, label: `${parsed.key.type} · ${parsed.key.bits} bits` });
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.account.sshKeys.pathKey() });
  const add = useMutation(
    trpc.account.sshKeys.add.mutationOptions({
      onSuccess: async () => {
        toast.success("SSH key added");
        setName("");
        setPublicKey("");
        await invalidate();
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const remove = useMutation(
    trpc.account.sshKeys.delete.mutationOptions({
      onSuccess: async () => {
        toast.success("SSH key removed");
        await invalidate();
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>SSH keys</CardTitle>
        <CardDescription>
          SFTP logins use SSH keys only. Paste the <strong>public</strong> key (the <code>.pub</code> file), e.g. from{" "}
          <code>ssh-keygen -t ed25519</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {keys.isPending ? (
          <Skeleton className="h-16" />
        ) : keys.data?.length ? (
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
              {keys.data.map((k) => (
                <tr key={k.id}>
                  <td>
                    <span className="flex items-center gap-2">
                      <KeyRound className="size-3.5 text-muted-foreground" />
                      {k.name}
                    </span>
                    <span className="text-muted-foreground">{k.type}</span>
                  </td>
                  <td className="font-mono">{k.fingerprint}</td>
                  <td>{new Date(k.createdAt).toLocaleDateString()}</td>
                  <td>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}</td>
                  <td className="text-right">
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={remove.isPending}
                      onClick={() => confirm(`Remove the key "${k.name}"?`) && remove.mutate({ id: k.id })}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="text-muted-foreground">No keys yet. Add one below to use SFTP.</p>
        )}

        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!preview?.fingerprint || !name.trim()) return;
            add.mutate({ name: name.trim(), publicKey });
          }}
        >
          <Field
            label="Public key"
            hint={
              preview?.error ? (
                <span className="text-destructive">{preview.error}</span>
              ) : preview?.fingerprint ? (
                <span className="font-mono">
                  {preview.label} · {preview.fingerprint}
                </span>
              ) : undefined
            }
          >
            <Textarea
              value={publicKey}
              onChange={(e) => {
                setPublicKey(e.target.value);
                const parsed = parseSshPublicKey(e.target.value);
                if (!name && parsed.ok && parsed.key.comment) setName(parsed.key.comment.slice(0, 64));
              }}
              placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA… you@laptop"
              className="min-h-20"
              spellCheck={false}
            />
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Name" className="w-72">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Laptop" maxLength={64} />
            </Field>
            <Button type="submit" disabled={!preview?.fingerprint || !name.trim() || add.isPending}>
              {add.isPending ? "Adding…" : "Add key"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmNext, setConfirmNext] = useState("");
  const [saving, setSaving] = useState(false);
  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirmNext.length > 0 && confirmNext !== next;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>For signing in to the panel. Other devices are signed out when you change it.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-sm gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!current || next.length < 8 || next !== confirmNext) return;
            setSaving(true);
            const { error } = await authClient.changePassword({
              currentPassword: current,
              newPassword: next,
              revokeOtherSessions: true,
            });
            setSaving(false);
            if (error) {
              toast.error(error.message ?? "Couldn't change the password");
              return;
            }
            toast.success("Password changed");
            setCurrent("");
            setNext("");
            setConfirmNext("");
          }}
        >
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field
            label="New password"
            hint={tooShort ? <span className="text-destructive">At least 8 characters.</span> : undefined}
          >
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field
            label="Repeat new password"
            hint={mismatch ? <span className="text-destructive">Passwords don't match.</span> : undefined}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmNext}
              onChange={(e) => setConfirmNext(e.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" disabled={saving || !current || next.length < 8 || next !== confirmNext}>
              {saving ? "Saving…" : "Change password"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
