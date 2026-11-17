import { needsTwoFactorSetup } from "@vango-panel/auth/two-factor";
import { redirect } from "next/navigation";

import { getSession, SETUP_2FA_PATH, twoFactorPolicy } from "@/lib/session";

export default async function Root() {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  redirect(needsTwoFactorSetup(session.user, twoFactorPolicy()) ? SETUP_2FA_PATH : "/dashboard");
}
