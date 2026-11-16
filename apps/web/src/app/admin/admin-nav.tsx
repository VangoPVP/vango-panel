"use client";
import { cn } from "@vango-panel/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin/servers", label: "Servers" },
  { href: "/admin/nodes", label: "Nodes" },
  { href: "/admin/templates", label: "Templates" },
  { href: "/admin/databases", label: "Databases" },
  { href: "/admin/users", label: "Users" },
] as const;

export default function AdminNav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 border-b text-sm">
      <span className="mr-3 py-1.5 font-semibold">Admin</span>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cn(
            "-mb-px border-b-2 px-3 py-1.5",
            path.startsWith(l.href) ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
