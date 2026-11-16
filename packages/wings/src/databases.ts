// Naming + validation for per-server MariaDB/MySQL databases. Pure (no node imports) so the browser
// can use it too. Everything that ends up as an SQL identifier is restricted to [a-z0-9_] here, and
// escaped again at the SQL layer.

/** User-chosen part of a database name, e.g. "perms" → s1a2b3c4d_perms. */
export const DATABASE_SUFFIX_RE = /^[a-z0-9_]{1,48}$/;
/** MySQL account host part: %, an IP / IP pattern (172.31.250.%), or a hostname. */
export const DATABASE_REMOTE_RE = /^[A-Za-z0-9.:%_-]{1,255}$/;

const ID_RE = /^[0-9a-f]{8}/i;

function serverPrefix(serverId: string): string {
  const m = ID_RE.exec(serverId);
  if (!m) throw new Error("invalid server id");
  return m[0].toLowerCase();
}

export function normalizeDatabaseSuffix(input: string): string {
  return input.trim().toLowerCase();
}

export function databaseSuffixError(input: string): string | null {
  const v = normalizeDatabaseSuffix(input);
  if (!v) return "Enter a name";
  if (!DATABASE_SUFFIX_RE.test(v)) return "Use 1-48 characters: a-z, 0-9 and _";
  return null;
}

/** Full database name on the host: s<first 8 hex of server id>_<suffix> (max 58 chars, MySQL limit 64). */
export function databaseNameFor(serverId: string, suffix: string): string {
  const v = normalizeDatabaseSuffix(suffix);
  if (databaseSuffixError(v)) throw new Error("invalid database name");
  return `s${serverPrefix(serverId)}_${v}`;
}

/** Username: u<first 8 hex of server id>_<random> (18 chars, fits MySQL's 32-char limit). */
export function databaseUsernameFor(serverId: string, random: string): string {
  if (!/^[a-z0-9]{8}$/.test(random)) throw new Error("random part must be 8 chars of [a-z0-9]");
  return `u${serverPrefix(serverId)}_${random}`;
}

export function isValidDatabaseRemote(remote: string): boolean {
  return DATABASE_REMOTE_RE.test(remote);
}

export function jdbcUrl(db: { host: string; port: number; name: string }): string {
  const host = db.host.includes(":") && !db.host.startsWith("[") ? `[${db.host}]` : db.host;
  return `jdbc:mariadb://${host}:${db.port}/${db.name}`;
}
