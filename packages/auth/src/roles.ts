export const ROLES = ["superadmin", "admin", "user"] as const;
export type Role = (typeof ROLES)[number];

export const ASSIGNABLE_ROLES = ["admin", "user"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "superadmin";
}

export function isSuperAdmin(role: string | null | undefined): boolean {
  return role === "superadmin";
}
