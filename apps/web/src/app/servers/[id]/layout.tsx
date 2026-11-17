import { requireSession } from "@/lib/session";

import ServerShell from "./server-shell";

export default async function ServerLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  await requireSession();
  const { id } = await params;
  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <ServerShell id={id}>{children}</ServerShell>
    </div>
  );
}
