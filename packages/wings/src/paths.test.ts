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
  expect(languageFor("en_us.lang")).toBe("properties");
  expect(languageFor("start.bat")).toBe("shell");
  expect(languageFor("build.gradle")).toBe("javascript");
});

const f = (name: string, mime: string, size = 100) => ({ name, mime, size, file: true });
const OCTET = "application/octet-stream";

test("text files are editable regardless of wings' mime guess", () => {
  expect(isEditable(f("latest.log", "text/plain"))).toBe(true);
  expect(isEditable(f("ops.json", "application/json"))).toBe(true);
  expect(isEditable(f("empty.txt", "inode/x-empty", 0))).toBe(true);
  // mime_guess has no entry for these → octet-stream
  expect(isEditable(f("server.properties", OCTET))).toBe(true);
  expect(isEditable(f("pack.mcmeta", OCTET))).toBe(true);
  expect(isEditable(f(".env", OCTET))).toBe(true);
  expect(isEditable(f("start", OCTET))).toBe(true);
  expect(isEditable(f("Dockerfile", OCTET))).toBe(true);
  expect(isEditable(f("session.lock", OCTET))).toBe(true);
  // mime_guess gets these wrong
  expect(isEditable(f("start.bat", "application/x-msdownload"))).toBe(true);
  expect(isEditable(f("index.ts", "video/vnd.dlna.mpeg-tts"))).toBe(true);
  expect(isEditable(f("logo.svg", "image/svg+xml"))).toBe(true);
});

test("binary files are not editable", () => {
  expect(isEditable(f("server.jar", "application/java-archive"))).toBe(false);
  expect(isEditable(f("Paper.JAR", OCTET))).toBe(false);
  expect(isEditable(f("world.tar.gz", "application/gzip"))).toBe(false);
  expect(isEditable(f("level.dat", OCTET))).toBe(false);
  expect(isEditable(f("level.dat_old", OCTET))).toBe(false);
  expect(isEditable(f("r.0.0.mca", OCTET))).toBe(false);
  expect(isEditable(f("luckperms-h2.mv.db", OCTET))).toBe(false);
  expect(isEditable(f("server-icon.png", "image/png"))).toBe(false);
  expect(isEditable(f("mystery", "image/x-unknown"))).toBe(false);
  expect(isEditable(f("big.txt", "text/plain", 5 * 1024 * 1024))).toBe(false);
  expect(isEditable({ name: "plugins", file: false, size: 0, mime: "inode/directory" })).toBe(false);
});
