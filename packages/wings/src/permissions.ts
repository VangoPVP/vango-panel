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
  "database.read",
  "database.create",
  "database.update",
  "database.delete",
  "database.view-password",
  "user.read",
  "user.create",
  "user.update",
  "user.delete",
] as const;

export type ServerPermission = (typeof SERVER_PERMISSIONS)[number];

export type PermissionGroup = {
  label: string;
  permissions: { key: ServerPermission; label: string; description: string }[];
};

/**
 * What can be granted to subusers, grouped for the UI. Not listed:
 * - websocket.connect: every subuser always gets it (view console output + live stats);
 * - backup.read: there is no backups feature yet.
 */
export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    label: "Console & power",
    permissions: [
      { key: "control.console", label: "Send commands", description: "Type commands into the server console." },
      { key: "control.start", label: "Start", description: "Start the server." },
      { key: "control.stop", label: "Stop", description: "Stop the server." },
      { key: "control.restart", label: "Restart", description: "Restart the server." },
      { key: "control.kill", label: "Kill", description: "Force-kill the server and remove its container." },
    ],
  },
  {
    label: "Files",
    permissions: [
      { key: "file.read", label: "List files", description: "See the file manager and folder contents." },
      { key: "file.read-content", label: "Read & download", description: "Open files in the editor and download them." },
      { key: "file.create", label: "Create & upload", description: "Create files and folders, upload, pull from URL." },
      { key: "file.update", label: "Edit", description: "Save changes, rename, move and change permissions." },
      { key: "file.delete", label: "Delete", description: "Delete files and folders." },
      { key: "file.archive", label: "Archive", description: "Compress and extract archives." },
      { key: "file.sftp", label: "SFTP", description: "Connect over SFTP with their own SSH keys." },
    ],
  },
  {
    label: "Startup",
    permissions: [
      { key: "startup.read", label: "View", description: "See the startup command and variables." },
      { key: "startup.update", label: "Edit variables", description: "Change editable startup variables." },
      { key: "startup.docker-image", label: "Docker image", description: "Switch between the template's images." },
    ],
  },
  {
    label: "Databases",
    permissions: [
      { key: "database.read", label: "View", description: "See the server's databases." },
      { key: "database.create", label: "Create", description: "Create new databases (within the limit)." },
      { key: "database.update", label: "Rotate passwords", description: "Generate new database passwords." },
      { key: "database.delete", label: "Delete", description: "Delete databases and all their data." },
      { key: "database.view-password", label: "View passwords", description: "See and copy database passwords." },
    ],
  },
  {
    label: "Users",
    permissions: [
      { key: "user.read", label: "View", description: "See who else has access to this server." },
      { key: "user.create", label: "Add", description: "Give other people access (only with permissions they have themselves)." },
      { key: "user.update", label: "Edit", description: "Change other subusers' permissions (only ones they have themselves)." },
      { key: "user.delete", label: "Remove", description: "Remove other subusers." },
    ],
  },
];

export const ASSIGNABLE_PERMISSIONS: ServerPermission[] = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

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

/** Permissions the caller may hand out (or take away): only ones they hold themselves. */
export function grantablePermissions(callerPermissions: readonly string[]): ServerPermission[] {
  return ASSIGNABLE_PERMISSIONS.filter((p) => hasPermission(callerPermissions, p));
}

/**
 * Why `caller` may not change a subuser's permissions from `before` to `after`, or null if allowed.
 * Every permission added *or removed* must be one the caller holds, so nobody can escalate or
 * strip permissions above their own level.
 */
export function permissionChangeError(
  callerPermissions: readonly string[],
  before: readonly string[],
  after: readonly string[],
): string | null {
  const assignable = (p: string) => (ASSIGNABLE_PERMISSIONS as string[]).includes(p);
  const added = after.filter((p) => !before.includes(p));
  // Only newly added ones must be known; stored legacy ones (e.g. backup.read) may be kept as-is.
  const unknown = added.filter((p) => !assignable(p));
  if (unknown.length) return `Unknown permission(s): ${unknown.join(", ")}`;
  const changed = [...added, ...before.filter((p) => assignable(p) && !after.includes(p))];
  const notHeld = changed.filter((p) => !hasPermission(callerPermissions, p));
  return notHeld.length ? `You can only grant or remove permissions you have yourself: ${notHeld.join(", ")}` : null;
}
