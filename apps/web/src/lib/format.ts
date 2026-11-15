export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "–";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function formatMib(mib: number, unlimitedAt = 0): string {
  if (mib === unlimitedAt || (unlimitedAt === 0 && mib <= 0)) return "Unlimited";
  return formatBytes(mib * 1024 * 1024);
}

export function formatUptime(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "–";
  let s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  s %= 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatCpu(percent: number | null | undefined, limit?: number): string {
  if (percent == null) return "–";
  const v = `${percent.toFixed(1)}%`;
  return limit ? `${v} / ${limit}%` : v;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-_]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}
