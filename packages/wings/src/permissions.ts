export const SERVER_PERMISSIONS = [
  "websocket.connect",
  "control.console",
  "control.start",
  "control.stop",
  "control.restart",
  "control.kill",
  "backup.read",
  "file.read",
  "file.read-content",
  "file.create",
  "file.update",
  "file.delete",
  "file.archive",
  "file.sftp",
  "startup.read",
  "startup.update",
  "startup.docker-image",
] as const;

export type ServerPermission = (typeof SERVER_PERMISSIONS)[number];

export function hasPermission(granted: readonly string[], perm: string): boolean {
  return granted.includes("*") || granted.includes(perm);
}

export function effectivePermissions(opts: {
  userId: string;
  isAdmin: boolean;
  ownerId: string;
  subuserPermissions: string[] | null;
}): string[] | null {
  if (opts.isAdmin || opts.userId === opts.ownerId) return ["*"];
  if (!opts.subuserPermissions) return null;
  return Array.from(new Set(["websocket.connect", ...opts.subuserPermissions]));
}
