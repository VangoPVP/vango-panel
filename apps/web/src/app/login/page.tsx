import { auth } from "@vango-panel/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import LoginForms from "./login-forms";

export default async function LoginPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user) redirect("/dashboard");
  return <LoginForms />;
}
