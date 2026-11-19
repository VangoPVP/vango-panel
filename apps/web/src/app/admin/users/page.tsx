"use client";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@vango-panel/ui/components/input";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PageShell, Table } from "@/components/form";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

import { RoleLabel } from "./role-label";

export default function UsersPage() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [search, setSearch] = useState("");
  const users = useQuery(trpc.admin.users.list.queryOptions({ search }));

  return (
    <PageShell
      title="Users"
      description="Everyone who has signed up. Click a user to edit, reset or delete them."
      actions={
        <Input
          className="w-64"
          placeholder="Search email, name or username…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      }
    >
      <Table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Username</th>
            <th>Email</th>
            <th>Servers</th>
            <th>Joined</th>
            <th>2FA</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          {users.data?.map((u) => {
            const href = `/admin/users/${u.id}` as Route;
            return (
              <tr key={u.id} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push(href)}>
                <td>
                  <Link href={href} className="font-medium underline-offset-2 hover:underline">
                    {u.name}
                  </Link>
                  {u.id === session?.user.id ? <span className="text-muted-foreground"> (you)</span> : null}
                </td>
                <td className="font-mono">{u.username ? `@${u.username}` : "–"}</td>
                <td>{u.email}</td>
                <td>{u.servers}</td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td>
                  {u.twoFactorEnabled ? (
                    <span className="text-green-600 dark:text-green-400">On</span>
                  ) : (
                    <span className="text-muted-foreground">Off</span>
                  )}
                </td>
                <td>
                  <RoleLabel role={u.role} />
                </td>
              </tr>
            );
          })}
          {users.data?.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-muted-foreground">
                No users found.
              </td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </PageShell>
  );
}
