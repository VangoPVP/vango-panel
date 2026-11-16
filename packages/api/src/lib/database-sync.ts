import prisma from "@vango-panel/db";
import { allowedSources, decryptSecret } from "@vango-panel/wings";

import { syncDatabases } from "./mysql";

// Keeps every database user's accounts in MariaDB in line with the panel: one account per allowed
// source (host's list + every node's public host). Called after node and database-host changes.

type HostRow = { id: string; name: string; allowedRemote: string; allowAllNodes: boolean };

export async function sourcesForHost(host: Pick<HostRow, "allowedRemote" | "allowAllNodes">): Promise<string[]> {
  const nodes = host.allowAllNodes ? await prisma.node.findMany({ select: { sftpHost: true } }) : [];
  return allowedSources(host, nodes);
}

export type HostSyncResult = { host: string; synced: number; failed: { name: string; error: string }[]; error?: string };

export async function syncDatabaseHost(hostId: string): Promise<HostSyncResult> {
  const host = await prisma.databaseHost.findUnique({ where: { id: hostId }, include: { databases: true } });
  if (!host) return { host: hostId, synced: 0, failed: [], error: "Database host not found" };
  if (!host.databases.length) return { host: host.name, synced: 0, failed: [] };
  const sources = await sourcesForHost(host);
  try {
    const r = await syncDatabases(
      host,
      host.databases.map((d) => ({ name: d.name, username: d.username, password: decryptSecret(d.passwordEncrypted) })),
      sources,
    );
    return { host: host.name, ...r };
  } catch (e) {
    return { host: host.name, synced: 0, failed: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Syncs every host that uses node IPs (call after a node is added, removed or its public host changes). */
export async function syncNodeDependentHosts(): Promise<HostSyncResult[]> {
  const hosts = await prisma.databaseHost.findMany({ where: { allowAllNodes: true }, select: { id: true } });
  return Promise.all(hosts.map((h) => syncDatabaseHost(h.id)));
}

/** Human-readable warning for sync problems, or undefined when everything synced. */
export function syncWarning(results: HostSyncResult[]): string | undefined {
  const parts = results.flatMap((r) =>
    r.error
      ? [`${r.host}: ${r.error}`]
      : r.failed.length
        ? [`${r.host}: couldn't update ${r.failed.map((f) => f.name).join(", ")}`]
        : [],
  );
  return parts.length ? `Database users not fully synced (${parts.join("; ")}). Use "Sync users" on Admin → Databases to retry.` : undefined;
}
