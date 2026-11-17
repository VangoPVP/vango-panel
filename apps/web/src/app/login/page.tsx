import { needsTwoFactorSetup } from "@vango-panel/auth/two-factor";
import { redirect } from "next/navigation";

import { getSession, SETUP_2FA_PATH, twoFactorPolicy } from "@/lib/session";

import LoginForms from "./login-forms";

export default async function LoginPage() {
  const session = await getSession();
  if (session?.user) redirect(needsTwoFactorSetup(session.user, twoFactorPolicy()) ? SETUP_2FA_PATH : "/dashboard");
  return <LoginForms />;
}
