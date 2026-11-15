import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { Allocation, Server, Template } from "@vango-panel/db";

import { buildInstallationScript, buildServerConfiguration, renderStartup, resolveEnvironment } from "./config";
import { decryptSecret, encryptSecret, randomToken, safeEqual } from "./crypto";
import { signWebsocketToken } from "./jwt";
import { effectivePermissions, hasPermission } from "./permissions";

const now = new Date();

const template: Template = {
  id: "0a023256-23fc-471b-a46a-3ac6e9199341",
  name: "t",
  description: "",
  image: "img:default",
  dockerImages: {},
  features: [],
  startup: "java -Xmx{{SERVER_MEMORY}}M -jar {{JAR}}",
  stopType: "command",
  stopValue: "stop",
  startupDone: ["Done ("],
  stripAnsi: true,
  configFiles: [
    { file: "server.properties", parser: "properties", replace: [{ match: "server-port", replace_with: "{{server.build.default.port}}" }] },
    { file: "bad", parser: "nope" },
  ],
  fileDenylist: ["*.jar"],
  installImage: "busybox:latest",
  installEntrypoint: "sh",
  installScript: "echo hi",
  variables: [
    { key: "JAR", name: "Jar", description: "", default: "server.jar", userEditable: true },
    { key: "MOTD", name: "Motd", description: "", default: "hello", userEditable: false },
  ],
  createdAt: now,
  updatedAt: now,
};

const alloc = (id: string, ip: string, port: number): Allocation => ({
  id,
  nodeId: "n",
  ip,
  port,
  serverId: "8d3f2a1c-5b6e-4f7a-9c0d-1e2f3a4b5c6d",
  createdAt: now,
});

const a1 = alloc("a1", "0.0.0.0", 25566);
const a2 = alloc("a2", "0.0.0.0", 25565);
const a3 = alloc("a3", "10.0.0.1", 8080);

const server: Server & { template: Template; allocations: Allocation[]; defaultAllocation: Allocation | null } = {
  id: "8d3f2a1c-5b6e-4f7a-9c0d-1e2f3a4b5c6d",
  name: "srv",
  description: "d",
  ownerId: "u1",
  nodeId: "n",
  templateId: template.id,
  status: null,
  suspended: false,
  skipInstall: false,
  image: "img:custom",
  startup: template.startup,
  environment: { JAR: "paper.jar" },
  memoryMib: 2048,
  swapMib: -1,
  diskMib: 10240,
  cpuPercent: 200,
  ioWeight: 500,
  threads: null,
  oomDisabled: false,
  defaultAllocationId: "a1",
  lastState: null,
  lastUtilization: null,
  lastReportAt: null,
  installedAt: null,
  createdAt: now,
  updatedAt: now,
  template,
  allocations: [a1, a2, a3],
  defaultAllocation: a1,
};

describe("server configuration", () => {
  test("environment = template defaults overlaid with server values", () => {
    expect(resolveEnvironment(server)).toEqual({ JAR: "paper.jar", MOTD: "hello" });
  });

  test("startup placeholders", () => {
    expect(renderStartup("a {{X}} {{env.Y}} {{UNKNOWN}} {{ X }}", { X: "1", Y: "2" })).toBe("a 1 2 {{UNKNOWN}} 1");
  });

  test("matches the wings ServerConfiguration shape", () => {
    const c = buildServerConfiguration(server);
    expect(c.settings.uuid).toBe(server.id);
    expect(c.settings.invocation).toBe("java -Xmx2048M -jar paper.jar");
    expect(c.settings.allocations.default).toEqual({ ip: "0.0.0.0", port: 25566 });
    expect(c.settings.allocations.mappings).toEqual({ "0.0.0.0": [25565, 25566], "10.0.0.1": [8080] });
    expect(c.settings.build).toEqual({
      memory_limit: 2048,
      swap: -1,
      io_weight: 500,
      cpu_limit: 200,
      threads: null,
      disk_space: 10240,
      oom_disabled: false,
    });
    expect(c.settings.container.image).toBe("img:custom");
    expect(c.settings.egg).toEqual({ id: template.id, file_denylist: ["*.jar"] });
    expect(c.settings.skip_egg_scripts).toBe(false);
    expect(c.process_configuration.stop).toEqual({ type: "command", value: "stop" });
    expect(c.process_configuration.startup.done).toEqual(["Done ("]);
    expect(c.process_configuration.configs).toHaveLength(0);
  });

  test("valid config files pass through", () => {
    const c = buildServerConfiguration({ ...server, template: { ...template, configFiles: (template.configFiles as object[]).slice(0, 1) } });
    expect(c.process_configuration.configs).toEqual([
      { file: "server.properties", parser: "properties", replace: [{ match: "server-port", replace_with: "{{server.build.default.port}}" }] },
    ]);
  });

  test("empty install script or skipInstall skips egg scripts", () => {
    expect(buildServerConfiguration({ ...server, skipInstall: true }).settings.skip_egg_scripts).toBe(true);
    expect(
      buildServerConfiguration({ ...server, template: { ...template, installScript: "  \n" } }).settings.skip_egg_scripts,
    ).toBe(true);
  });

  test("installation script", () => {
    expect(buildInstallationScript(template)).toEqual({ container_image: "busybox:latest", entrypoint: "sh", script: "echo hi" });
  });
});

describe("crypto", () => {
  test("encrypt/decrypt roundtrip, random iv", () => {
    const a = encryptSecret("dev-node-token");
    const b = encryptSecret("dev-node-token");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("dev-node-token");
  });

  test("tampering is detected", () => {
    const raw = Buffer.from(encryptSecret("x"), "base64");
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    expect(() => decryptSecret(raw.toString("base64"))).toThrow();
  });

  test("tokens never contain the token_id separator", () => {
    for (let i = 0; i < 200; i++) expect(randomToken(48)).not.toContain(".");
  });

  test("safeEqual", () => {
    expect(safeEqual("a", "a")).toBe(true);
    expect(safeEqual("a", "b")).toBe(false);
    expect(safeEqual("a", "aa")).toBe(false);
  });
});

describe("websocket jwt", () => {
  test("HS256 with the node token and the claims wings expects", () => {
    const { token, expiresAt } = signWebsocketToken({
      nodeToken: "secret",
      userId: "u1",
      serverId: server.id,
      permissions: ["websocket.connect"],
    });
    const [h, p, sig] = token.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" });
    expect(createHmac("sha256", "secret").update(`${h}.${p}`).digest("base64url")).toBe(sig);
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(claims).toMatchObject({ user_uuid: "u1", server_uuid: server.id, permissions: ["websocket.connect"], exp: expiresAt });
    expect(typeof claims.jti).toBe("string");
    expect(Object.values(claims)).not.toContain(null);
  });
});

describe("permissions", () => {
  test("owner/admin get *, subusers their grant + websocket.connect, others nothing", () => {
    const base = { userId: "u1", isAdmin: false, ownerId: "u2", subuserPermissions: null };
    expect(effectivePermissions(base)).toBeNull();
    expect(effectivePermissions({ ...base, isAdmin: true })).toEqual(["*"]);
    expect(effectivePermissions({ ...base, ownerId: "u1" })).toEqual(["*"]);
    expect(effectivePermissions({ ...base, subuserPermissions: ["control.console"] })).toEqual([
      "websocket.connect",
      "control.console",
    ]);
    expect(hasPermission(["*"], "control.kill")).toBe(true);
    expect(hasPermission(["control.start"], "control.kill")).toBe(false);
  });
});
