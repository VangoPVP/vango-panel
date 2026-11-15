import { auth } from "@vango-panel/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import ServerShell from "./server-shell";

export default async function ServerLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/login");
  const { id } = await params;
  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <ServerShell id={id}>{children}</ServerShell>
    </div>
  );
}
