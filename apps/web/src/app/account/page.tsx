import { auth } from "@vango-panel/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import AccountView from "./account-view";

export default async function AccountPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");
  return (
    <div className="container mx-auto max-w-4xl px-4 py-6">
      <AccountView />
    </div>
  );
}
