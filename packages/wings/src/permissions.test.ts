import { expect, test } from "bun:test";

import {
  ASSIGNABLE_PERMISSIONS,
  grantablePermissions,
  PERMISSION_GROUPS,
  permissionChangeError,
  SERVER_PERMISSIONS,
} from "./permissions";

test("every assignable permission is a real permission and appears exactly once", () => {
  const keys = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));
  expect(new Set(keys).size).toBe(keys.length);
  for (const k of keys) expect(SERVER_PERMISSIONS).toContain(k);
  // everything except the implicit/unused ones is grantable
  expect([...SERVER_PERMISSIONS].filter((p) => !keys.includes(p)).sort()).toEqual(["backup.read", "websocket.connect"]);
});

test("owners/admins (*) can grant everything", () => {
  expect(grantablePermissions(["*"])).toEqual(ASSIGNABLE_PERMISSIONS);
  expect(permissionChangeError(["*"], [], ["file.read", "user.update"])).toBeNull();
});

test("subusers can only grant or remove permissions they hold", () => {
  const caller = ["user.update", "file.read", "file.read-content"];
  expect(grantablePermissions(caller)).toEqual(["file.read", "file.read-content", "user.update"]);
  expect(permissionChangeError(caller, ["file.read"], ["file.read", "file.read-content"])).toBeNull();
  expect(permissionChangeError(caller, [], ["file.delete"])).toContain("file.delete");
  // can't strip something above their level either
  expect(permissionChangeError(caller, ["file.read", "startup.update"], ["file.read"])).toContain("startup.update");
  // untouched permissions they don't hold are fine
  expect(permissionChangeError(caller, ["startup.update"], ["startup.update", "file.read"])).toBeNull();
});

test("unknown permissions are rejected; legacy unmanaged ones don't block edits", () => {
  expect(permissionChangeError(["*"], [], ["admin.everything"])).toContain("Unknown");
  expect(permissionChangeError(["file.read"], ["backup.read", "file.read"], [])).toBeNull();
  // keeping a stored legacy permission while editing others is fine
  expect(permissionChangeError(["*"], ["backup.read", "file.read"], ["backup.read"])).toBeNull();
  expect(permissionChangeError(["*"], ["file.read"], ["file.read", "backup.read"])).toContain("Unknown");
});
