import { auth } from "@vango-panel/auth";
import { needsTwoFactorSetup } from "@vango-panel/auth/two-factor";
import { env } from "@vango-panel/env/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const SETUP_2FA_PATH = "/account?setup2fa=1";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * Signed-in session for protected pages. Users who must use 2FA but haven't set it up yet are sent
 * to their account page (the only page they can use until then; the API enforces the same).
 */
export async function requireSession(opts: { allowPending2fa?: boolean } = {}) {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  if (!opts.allowPending2fa && needsTwoFactorSetup(session.user, env.PANEL_REQUIRE_2FA)) redirect(SETUP_2FA_PATH);
  return session;
}

export function twoFactorPolicy() {
  return env.PANEL_REQUIRE_2FA;
}
