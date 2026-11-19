import { isSuperAdmin } from "@vango-panel/auth/roles";
import { Lock } from "lucide-react";

export function RoleLabel({ role }: { role: string }) {
  if (isSuperAdmin(role)) {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium" title="The super admin's role can't be changed">
        <Lock className="size-3" /> Super Admin
      </span>
    );
  }
  return role === "admin" ? <span className="font-medium">Admin</span> : <span>User</span>;
}
