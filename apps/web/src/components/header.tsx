"use client";
import { isAdminRole } from "@vango-panel/auth/roles";
import Link from "next/link";

import { authClient, type Session } from "@/lib/auth-client";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Header({ initialSession }: { initialSession: Session | null }) {
  const { data, isPending } = authClient.useSession();
  // Server-rendered session covers the first paint; the client hook takes over once it resolves
  // (and keeps the header in sync after sign-in / sign-out).
  const session = isPending ? initialSession : data;
  const links = session
    ? ([
        { to: "/dashboard", label: "Servers" },
        ...(isAdminRole(session.user.role) ? [{ to: "/admin", label: "Admin" } as const] : []),
      ] as const)
    : [];

  return (
    <div>
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <nav className="flex gap-4 text-lg">
          {links.map(({ to, label }) => {
            return (
              <Link key={to} href={to}>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <ModeToggle />
          <UserMenu session={session} />
        </div>
      </div>
      <hr />
    </div>
  );
}
