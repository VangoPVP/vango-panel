import { isAdminRole } from "./roles";

export type TwoFactorPolicy = "none" | "admins" | "all";

type UserLike = { role?: string | null; twoFactorEnabled?: boolean | null };

/** Whether policy demands 2FA from this user at all. */
export function twoFactorRequiredFor(user: UserLike, policy: TwoFactorPolicy): boolean {
  if (policy === "all") return true;
  if (policy === "admins") return isAdminRole(user.role);
  return false;
}

/** True when the user must set up 2FA before using anything except their account page. */
export function needsTwoFactorSetup(user: UserLike, policy: TwoFactorPolicy): boolean {
  return twoFactorRequiredFor(user, policy) && !user.twoFactorEnabled;
}
