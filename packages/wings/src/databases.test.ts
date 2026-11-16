import { expect, test } from "bun:test";

import {
  allowedSources,
  databaseNameFor,
  databaseSuffixError,
  databaseUsernameFor,
  isValidDatabaseRemote,
  jdbcUrl,
  parseRemoteList,
  remoteListError,
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

test("remote lists", () => {
  expect(parseRemoteList(" 172.31.250.%, 192.168.2.113 ,172.31.250.%\n10.0.0.1")).toEqual([
    "172.31.250.%",
    "192.168.2.113",
    "10.0.0.1",
  ]);
  expect(parseRemoteList("")).toEqual([]);
  expect(remoteListError("172.31.250.%, 192.168.2.%")).toBeNull();
  expect(remoteListError("")).not.toBeNull();
  expect(remoteListError("172.31.250.%, a'b")).toContain("a'b");
});

test("allowed sources include every node's public host", () => {
  const nodes = [
    { sftpHost: "192.168.2.108" },
    { sftpHost: "192.168.2.113" },
    { sftpHost: "127.0.0.1" }, // loopback: skipped
    { sftpHost: "0.0.0.0" }, // wildcard: skipped
    { sftpHost: "bad host" }, // invalid: skipped
    { sftpHost: "192.168.2.113" }, // duplicate
  ];
  expect(allowedSources({ allowedRemote: "172.31.250.%", allowAllNodes: true }, nodes)).toEqual([
    "172.31.250.%",
    "192.168.2.108",
    "192.168.2.113",
  ]);
  expect(allowedSources({ allowedRemote: "172.31.250.%", allowAllNodes: false }, nodes)).toEqual(["172.31.250.%"]);
});

test("jdbc url", () => {
  expect(jdbcUrl({ host: "172.31.250.1", port: 3306, name: "sbe9d5bf5_perms" })).toBe(
    "jdbc:mariadb://172.31.250.1:3306/sbe9d5bf5_perms",
  );
  expect(jdbcUrl({ host: "fd00::1", port: 3306, name: "x" })).toBe("jdbc:mariadb://[fd00::1]:3306/x");
});
