import { expect, test } from "bun:test";

import { connectAddress, connectHost, formatHostPort, isLoopbackIp, isWildcardIp } from "./allocations";

const node = { sftpHost: "192.168.2.108" };

test("alias always wins", () => {
  expect(connectHost({ ip: "0.0.0.0", port: 1, ipAlias: "play.example.com" }, node)).toBe("play.example.com");
  expect(connectHost({ ip: "10.0.0.5", port: 1, ipAlias: " 1.2.3.4 " }, node)).toBe("1.2.3.4");
});

test("wildcard bind falls back to the node's public host", () => {
  expect(connectAddress({ ip: "0.0.0.0", port: 25565 }, node)).toBe("192.168.2.108:25565");
  expect(connectAddress({ ip: "::", port: 25565, ipAlias: null }, node)).toBe("192.168.2.108:25565");
  expect(connectAddress({ ip: "0.0.0.0", port: 25565, ipAlias: "  " }, node)).toBe("192.168.2.108:25565");
});

test("specific and loopback binds are shown as-is", () => {
  expect(connectAddress({ ip: "192.168.2.50", port: 25565 }, node)).toBe("192.168.2.50:25565");
  expect(connectAddress({ ip: "127.0.0.1", port: 25565 }, node)).toBe("127.0.0.1:25565");
});

test("IPv6 literals are bracketed", () => {
  expect(formatHostPort("fd00::1", 25565)).toBe("[fd00::1]:25565");
  expect(formatHostPort("[fd00::1]", 25565)).toBe("[fd00::1]:25565");
  expect(connectAddress({ ip: "::", port: 7777 }, { sftpHost: "fd00::2" })).toBe("[fd00::2]:7777");
});

test("ip classification", () => {
  expect(isWildcardIp("0.0.0.0")).toBe(true);
  expect(isWildcardIp("::")).toBe(true);
  expect(isWildcardIp("127.0.0.1")).toBe(false);
  expect(isLoopbackIp("127.0.0.1")).toBe(true);
  expect(isLoopbackIp("127.1.2.3")).toBe(true);
  expect(isLoopbackIp("::1")).toBe(true);
  expect(isLoopbackIp("192.168.2.108")).toBe(false);
});
