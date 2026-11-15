"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isSuperAdmin } from "@vango-panel/auth/roles";
import { usernameError } from "@vango-panel/auth/username";
import { Button } from "@vango-panel/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vango-panel/ui/components/dialog";
import { Input } from "@vango-panel/ui/components/input";
import { Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Field, PageShell, Select, Table } from "@/components/form";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

export default function UsersPage() {
  const qc = useQueryClient();
  const { data: session } = authClient.useSession();
  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; username: string } | null>(null);
  const users = useQuery(trpc.admin.users.list.queryOptions({ search }));
  const setRole = useMutation(
    trpc.admin.users.setRole.mutationOptions({
      onSuccess: () => {
        toast.success("Role updated");
        qc.invalidateQueries({ queryKey: trpc.admin.users.pathKey() });
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  return (
    <PageShell
      title="Users"
      description="Everyone who has signed up. New accounts are normal users until you make them admin."
      actions={<Input className="w-64" placeholder="Search email or name…" value={search} onChange={(e) => setSearch(e.target.value)} />}
    >
      <Table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Username</th>
            <th>Email</th>
            <th>Servers</th>
            <th>Joined</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          {users.data?.map((u) => (
            <tr key={u.id}>
              <td>
                {u.name}
                {u.id === session?.user.id ? <span className="text-muted-foreground"> (you)</span> : null}
              </td>
              <td>
                <span className="font-mono">{u.username ? `@${u.username}` : "–"}</span>{" "}
                <Button variant="ghost" size="xs" onClick={() => setRenaming({ id: u.id, username: u.username ?? "" })}>
                  Rename
                </Button>
              </td>
              <td>{u.email}</td>
              <td>{u.servers}</td>
              <td>{new Date(u.createdAt).toLocaleDateString()}</td>
              <td className="w-40">
                {isSuperAdmin(u.role) ? (
                  <span className="inline-flex items-center gap-1.5 font-medium" title="The super admin's role can't be changed">
                    <Lock className="size-3" /> Super Admin
                  </span>
                ) : (
                  <Select
                    value={u.role}
                    disabled={setRole.isPending}
                    onChange={(e) => {
                      const role = e.target.value as "admin" | "user";
                      if (u.id === session?.user.id && role === "user" && !confirm("Remove your own admin access?")) {
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
              </td>
            </tr>
          ))}
          {users.data?.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-muted-foreground">
                No users found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </Table>
      <Dialog open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          {renaming ? <RenameUser user={renaming} close={() => setRenaming(null)} /> : null}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function RenameUser({ user, close }: { user: { id: string; username: string }; close: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(user.username);
  const error = value ? usernameError(value) : null;
  const rename = useMutation(
    trpc.admin.users.setUsername.mutationOptions({
      onSuccess: async (r) => {
        toast.success(`Renamed to @${r.username}`);
        await qc.invalidateQueries({ queryKey: trpc.admin.users.pathKey() });
        close();
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!error && value.trim()) rename.mutate({ userId: user.id, username: value.trim() });
      }}
    >
      <DialogHeader>
        <DialogTitle>Rename @{user.username || "user"}</DialogTitle>
        <DialogDescription>This also changes their SFTP login.</DialogDescription>
      </DialogHeader>
      <Field label="Username" hint={error ? <span className="text-destructive">{error}</span> : undefined}>
        <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={!!error || !value.trim() || rename.isPending}>
          Rename
        </Button>
      </DialogFooter>
    </form>
  );
}
