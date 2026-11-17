import { isAdminRole } from "@vango-panel/auth/roles";

import { PageShell } from "@/components/form";
import { requireSession } from "@/lib/session";

import Dashboard, { ViewToggle } from "./dashboard";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await requireSession();

  const isAdmin = isAdminRole(session.user.role);
  const view = isAdmin && (await searchParams).view === "others" ? "others" : "mine";

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <PageShell
        title={view === "others" ? "Other servers" : "Your servers"}
        description={
          view === "others"
            ? "Servers you don't own or have access to. As an admin you can open and manage all of them."
            : `Signed in as ${session.user.name}`
        }
        actions={isAdmin ? <ViewToggle view={view} /> : null}
      >
        <Dashboard view={view} />
      </PageShell>
    </div>
  );
}
