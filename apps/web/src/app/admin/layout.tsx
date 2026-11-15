import { auth } from "@vango-panel/auth";
import { isAdminRole } from "@vango-panel/auth/roles";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import AdminNav from "./admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");
  if (!isAdminRole(session.user.role)) redirect("/dashboard");
  return (
    <div className="container mx-auto grid max-w-6xl gap-4 px-4 py-6">
      <AdminNav />
      {children}
    </div>
  );
}
