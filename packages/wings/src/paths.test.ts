import { expect, test } from "bun:test";

import {
  basename,
  breadcrumbs,
  isArchive,
  isEditable,
  isValidMode,
  isValidName,
  joinPath,
  languageFor,
  normalizePath,
  parentDir,
} from "./paths";

test("normalizePath never goes above root", () => {
  expect(normalizePath("")).toBe("/");
  expect(normalizePath("a//b/./c/")).toBe("/a/b/c");
  expect(normalizePath("/a/../../etc/passwd")).toBe("/etc/passwd");
  expect(normalizePath("..\\..\\x")).toBe("/x");
});

test("join / parent / basename / breadcrumbs", () => {
  expect(joinPath("/plugins", "a.yml")).toBe("/plugins/a.yml");
  expect(joinPath("/", "x")).toBe("/x");
  expect(parentDir("/a/b/c.txt")).toBe("/a/b");
  expect(parentDir("/")).toBe("/");
  expect(basename("/a/b/c.txt")).toBe("c.txt");
  expect(basename("/")).toBe("");
  expect(breadcrumbs("/plugins/Essentials")).toEqual([
    { name: "/", path: "/" },
    { name: "plugins", path: "/plugins" },
    { name: "Essentials", path: "/plugins/Essentials" },
  ]);
});

test("names, archives, modes", () => {
  expect(isValidName("server.properties")).toBe(true);
  expect(isValidName("..")).toBe(false);
  expect(isValidName("a/b")).toBe(false);
  expect(isValidName("  ")).toBe(false);
  expect(isArchive("world.tar.gz")).toBe(true);
  expect(isArchive("backup.ZIP")).toBe(true);
  expect(isArchive("world.gz")).toBe(false);
  expect(isValidMode("755")).toBe(true);
  expect(isValidMode("0644")).toBe(true);
  expect(isValidMode("888")).toBe(false);
});

test("editor languages and editability", () => {
  expect(languageFor("config.yml")).toBe("yaml");
  expect(languageFor("server.properties")).toBe("properties");
  expect(languageFor("velocity.toml")).toBe("toml");
  expect(languageFor("start.sh")).toBe("shell");
  expect(languageFor("ops.json")).toBe("json");
  expect(languageFor("latest.log")).toBe("text");
  expect(isEditable({ file: true, size: 100, mime: "text/plain" })).toBe(true);
  expect(isEditable({ file: true, size: 100, mime: "application/json" })).toBe(true);
  expect(isEditable({ file: true, size: 0, mime: "inode/x-empty" })).toBe(true);
  expect(isEditable({ file: true, size: 100, mime: "application/java-archive" })).toBe(false);
  expect(isEditable({ file: true, size: 5 * 1024 * 1024, mime: "text/plain" })).toBe(false);
  expect(isEditable({ file: false, size: 0, mime: "inode/directory" })).toBe(false);
});
