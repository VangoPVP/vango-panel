import { cn } from "@vango-panel/ui/lib/utils";

const STYLES: Record<string, string> = {
  running: "bg-green-500",
  starting: "bg-yellow-500 animate-pulse",
  stopping: "bg-orange-500 animate-pulse",
  offline: "bg-red-500",
  installing: "bg-blue-500 animate-pulse",
  install_failed: "bg-red-700",
  reinstall_failed: "bg-red-700",
  suspended: "bg-zinc-500",
  unknown: "bg-zinc-400",
};

const LABELS: Record<string, string> = {
  install_failed: "install failed",
  reinstall_failed: "reinstall failed",
  restoring_backup: "restoring",
};

export function displayState(opts: {
  status?: string | null;
  suspended?: boolean;
  state?: string | null;
}): string {
  if (opts.suspended) return "suspended";
  if (opts.status) return opts.status;
  return opts.state ?? "unknown";
}

export function StateBadge({ state, className }: { state: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", className)}>
      <span className={cn("size-2 rounded-full", STYLES[state] ?? STYLES.unknown)} />
      {LABELS[state] ?? state}
    </span>
  );
}
