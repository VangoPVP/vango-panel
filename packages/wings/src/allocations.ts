// An allocation's `ip` is the *bind* address handed to Docker (wings publishes the port on it).
// That is often 0.0.0.0 ("all interfaces"), which is not something a player can connect to,
// so the address shown to users is resolved separately:
//   1. the allocation's ipAlias, if an admin set one;
//   2. for wildcard binds (0.0.0.0 / ::), the node's public host (its SFTP host);
//   3. otherwise the bind IP itself.
// Loopback binds are shown as-is on purpose: such a port really is only reachable from the node.

type AllocationLike = { ip: string; port: number; ipAlias?: string | null };
type NodeLike = { sftpHost: string };

const WILDCARD_IPS = new Set(["0.0.0.0", "::", "[::]"]);

export function isWildcardIp(ip: string): boolean {
  return WILDCARD_IPS.has(ip.trim().toLowerCase());
}

export function isLoopbackIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  return v === "::1" || v === "localhost" || /^127\./.test(v) || /^::ffff:127\./.test(v);
}

/** Host (IP or hostname) users should connect to for this allocation. */
export function connectHost(allocation: AllocationLike, node: NodeLike): string {
  const alias = allocation.ipAlias?.trim();
  if (alias) return alias;
  if (isWildcardIp(allocation.ip)) return node.sftpHost;
  return allocation.ip;
}

/** `host:port`, with IPv6 literals bracketed. */
export function formatHostPort(host: string, port: number): string {
  const h = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${h}:${port}`;
}

/** Full `host:port` users should connect to for this allocation. */
export function connectAddress(allocation: AllocationLike, node: NodeLike): string {
  return formatHostPort(connectHost(allocation, node), allocation.port);
}
