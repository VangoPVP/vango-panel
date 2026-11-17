import { isAdminRole } from "@vango-panel/auth/roles";
import { redirect } from "next/navigation";

import { requireSession } from "@/lib/session";

import AdminNav from "./admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!isAdminRole(session.user.role)) redirect("/dashboard");
  return (
    <div className="container mx-auto grid max-w-6xl gap-4 px-4 py-6">
      <AdminNav />
      {children}
    </div>
  );
}
