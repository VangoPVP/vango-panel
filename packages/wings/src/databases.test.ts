import { expect, test } from "bun:test";

import {
  databaseNameFor,
  databaseSuffixError,
  databaseUsernameFor,
  isValidDatabaseRemote,
  jdbcUrl,
} from "./databases";

const SERVER = "BE9D5BF5-1234-4abc-9def-0123456789ab";

test("database names are prefixed with the server id", () => {
  expect(databaseNameFor(SERVER, "perms")).toBe("sbe9d5bf5_perms");
  expect(databaseNameFor(SERVER, "  LuckPerms_1 ")).toBe("sbe9d5bf5_luckperms_1");
  expect(databaseNameFor(SERVER, "a".repeat(48)).length).toBeLessThanOrEqual(64);
});

test("database suffix validation rejects anything that isn't [a-z0-9_]", () => {
  expect(databaseSuffixError("perms")).toBeNull();
  expect(databaseSuffixError("")).not.toBeNull();
  expect(databaseSuffixError("a".repeat(49))).not.toBeNull();
  for (const bad of ["my-db", "db name", "db`; DROP DATABASE x; --", "db.x", "ø", "db'"]) {
    expect(databaseSuffixError(bad)).not.toBeNull();
    expect(() => databaseNameFor(SERVER, bad)).toThrow();
  }
});

test("usernames fit MySQL's 32-char limit", () => {
  const u = databaseUsernameFor(SERVER, "abc12345");
  expect(u).toBe("ube9d5bf5_abc12345");
  expect(u.length).toBeLessThanOrEqual(32);
  expect(() => databaseUsernameFor(SERVER, "short")).toThrow();
  expect(() => databaseUsernameFor(SERVER, "ABC12345")).toThrow();
  expect(() => databaseUsernameFor("not-a-uuid", "abc12345")).toThrow();
});

test("remote host patterns", () => {
  for (const ok of ["%", "172.31.250.%", "127.0.0.1", "::1", "db-host.local"]) expect(isValidDatabaseRemote(ok)).toBe(true);
  for (const bad of ["", "a'b", "a b", "x@y", "a`b"]) expect(isValidDatabaseRemote(bad)).toBe(false);
});

test("jdbc url", () => {
  expect(jdbcUrl({ host: "172.31.250.1", port: 3306, name: "sbe9d5bf5_perms" })).toBe(
    "jdbc:mariadb://172.31.250.1:3306/sbe9d5bf5_perms",
  );
  expect(jdbcUrl({ host: "fd00::1", port: 3306, name: "x" })).toBe("jdbc:mariadb://[fd00::1]:3306/x");
});
