import { describe, expect, test } from "bun:test";

import { eggToTemplate, nextFreeName } from "./egg";

const paper = {
  _comment: "DO NOT EDIT: FILE GENERATED AUTOMATICALLY BY PTERODACTYL PANEL - PTERODACTYL.IO",
  meta: { version: "PTDL_v2", update_url: null },
  exported_at: "2024-01-01T00:00:00+00:00",
  name: "Paper",
  author: "parker@pterodactyl.io",
  description: "High performance Spigot fork that aims to fix gameplay and mechanics inconsistencies.",
  features: ["eula", "java_version", "pid_limit"],
  docker_images: {
    "Java 21": "ghcr.io/pterodactyl/yolks:java_21",
    "Java 17": "ghcr.io/pterodactyl/yolks:java_17",
  },
  file_denylist: [],
  startup:
    "java -Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false -Dterminal.ansi=true -jar {{SERVER_JARFILE}}",
  config: {
    files:
      '{\r\n    "server.properties": {\r\n        "parser": "properties",\r\n        "find": {\r\n            "server-ip": "0.0.0.0",\r\n            "server-port": "{{server.build.default.port}}",\r\n            "query.port": "{{server.build.default.port}}"\r\n        }\r\n    }\r\n}',
    startup: '{\r\n    "done": ")! For help, type "\r\n}',
    logs: "{}",
    stop: "stop",
  },
  scripts: {
    installation: {
      script: '#!/bin/ash\r\ncd /mnt/server\r\necho "installing paper"',
      container: "ghcr.io/pterodactyl/installers:alpine",
      entrypoint: "ash",
    },
  },
  variables: [
    {
      name: "Minecraft Version",
      description: "The version of minecraft to download.",
      env_variable: "MINECRAFT_VERSION",
      default_value: "latest",
      user_viewable: true,
      user_editable: true,
      rules: "nullable|string|max:20",
      field_type: "text",
    },
    {
      name: "Server Jar File",
      description: "The name of the server jarfile to run the server with.",
      env_variable: "SERVER_JARFILE",
      default_value: "server.jar",
      user_viewable: true,
      user_editable: true,
      rules: "required|regex:/^([\\w\\d._-]+)(\\.jar)$/",
      field_type: "text",
    },
    {
      name: "Download Path",
      description: "Hidden",
      env_variable: "DL_PATH",
      default_value: "",
      user_viewable: false,
      user_editable: true,
      rules: "nullable|string",
      field_type: "text",
    },
  ],
};

describe("eggToTemplate", () => {
  test("converts the Paper egg", () => {
    const r = eggToTemplate(paper);
    if (!r.ok) throw new Error(r.error);
    const t = r.template;
    expect(r.version).toBe("PTDL_v2");
    expect(r.author).toBe("parker@pterodactyl.io");
    expect(t.name).toBe("Paper");
    expect(t.image).toBe("ghcr.io/pterodactyl/yolks:java_21");
    expect(t.dockerImages).toEqual({
      "Java 21": "ghcr.io/pterodactyl/yolks:java_21",
      "Java 17": "ghcr.io/pterodactyl/yolks:java_17",
    });
    expect(t.startup).toContain("{{SERVER_JARFILE}}");
    expect(t).toMatchObject({ stopType: "command", stopValue: "stop", startupDone: [")! For help, type "] });
    expect(t.configFiles).toEqual([
      {
        file: "server.properties",
        parser: "properties",
        replace: [
          { match: "server-ip", replace_with: "0.0.0.0" },
          { match: "server-port", replace_with: "{{server.build.default.port}}" },
          { match: "query.port", replace_with: "{{server.build.default.port}}" },
        ],
      },
    ]);
    expect(t.installImage).toBe("ghcr.io/pterodactyl/installers:alpine");
    expect(t.installEntrypoint).toBe("ash");
    expect(t.installScript).toBe('#!/bin/ash\ncd /mnt/server\necho "installing paper"');
    expect(t.variables).toEqual([
      {
        key: "MINECRAFT_VERSION",
        name: "Minecraft Version",
        description: "The version of minecraft to download.",
        default: "latest",
        userEditable: true,
        rules: "nullable|string|max:20",
      },
      {
        key: "SERVER_JARFILE",
        name: "Server Jar File",
        description: "The name of the server jarfile to run the server with.",
        default: "server.jar",
        userEditable: true,
        rules: "required|regex:/^([\\w\\d._-]+)(\\.jar)$/",
      },
      { key: "DL_PATH", name: "Download Path", description: "Hidden", default: "", userEditable: false, rules: "nullable|string" },
    ]);
    expect(t.features).toEqual(["eula", "java_version", "pid_limit"]);
    expect(r.warnings).toEqual([]);
  });

  test("^C stop becomes SIGINT, empty stop becomes docker stop", () => {
    const sig = eggToTemplate({ ...paper, config: { ...paper.config, stop: "^C" } });
    expect(sig.ok && sig.template).toMatchObject({ stopType: "signal", stopValue: "SIGINT" });
    const none = eggToTemplate({ ...paper, config: { ...paper.config, stop: null } });
    expect(none.ok && none.template).toMatchObject({ stopType: "stop", stopValue: "" });
  });

  test("nested find values become conditional replacements; legacy placeholders rewritten", () => {
    const files = JSON.stringify({
      "config.yml": {
        parser: "yaml",
        find: {
          "listeners[0].host": { "0.0.0.0:25577": "0.0.0.0:{{server.build.default.port}}" },
          "server.ip": "{{config.docker.interface}}",
          "server.online": true,
        },
      },
      "weird.cfg": { parser: "lua", find: { a: "b" } },
    });
    const r = eggToTemplate({ ...paper, config: { ...paper.config, files } });
    if (!r.ok) throw new Error(r.error);
    expect(r.template.configFiles).toEqual([
      {
        file: "config.yml",
        parser: "yaml",
        replace: [
          { match: "listeners[0].host", if_value: "0.0.0.0:25577", replace_with: "0.0.0.0:{{server.build.default.port}}" },
          { match: "server.ip", replace_with: "{{config.docker.network.interface}}" },
          { match: "server.online", replace_with: true },
        ],
      },
    ]);
    expect(r.warnings.some((w) => w.includes('"lua"'))).toBe(true);
    expect(r.warnings.some((w) => w.includes("legacy placeholder"))).toBe(true);
  });

  test("PTDL_v1: single image, 0/1 booleans, done as array, extends warns", () => {
    const r = eggToTemplate({
      meta: { version: "PTDL_v1" },
      name: "Old egg",
      image: "quay.io/pterodactyl/core:java",
      startup: "./start.sh",
      config: { files: "[]", startup: '{"done": ["Ready", "Started"]}', stop: "quit", extends: 3 },
      scripts: { installation: { script: "echo hi", container: null, entrypoint: null } },
      variables: [
        { name: "X", env_variable: "X_VAR", default_value: 5, user_viewable: 1, user_editable: 0, rules: "required" },
        { name: "bad", env_variable: "lower-case", default_value: "", user_viewable: 1, user_editable: 1 },
      ],
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.template.image).toBe("quay.io/pterodactyl/core:java");
    expect(r.template.dockerImages).toEqual({ "quay.io/pterodactyl/core:java": "quay.io/pterodactyl/core:java" });
    expect(r.template.startupDone).toEqual(["Ready", "Started"]);
    expect(r.template.configFiles).toEqual([]);
    expect(r.template.installImage).toBe("ghcr.io/pterodactyl/installers:alpine");
    expect(r.template.installEntrypoint).toBe("bash");
    expect(r.template.variables).toEqual([
      { key: "X_VAR", name: "X", description: "", default: "5", userEditable: false, rules: "required" },
    ]);
    expect(r.warnings.some((w) => w.includes("config.extends"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("lower-case"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("No install container"))).toBe(true);
  });

  test("malformed config JSON is a warning, not a failure", () => {
    const r = eggToTemplate({ ...paper, config: { ...paper.config, files: "{not json", startup: "nope" } });
    if (!r.ok) throw new Error(r.error);
    expect(r.template.configFiles).toEqual([]);
    expect(r.template.startupDone).toEqual([]);
    expect(r.warnings.filter((w) => w.includes("not valid JSON"))).toHaveLength(2);
  });

  test("rejects things that aren't eggs", () => {
    expect(eggToTemplate({ hello: "world" }).ok).toBe(false);
    expect(eggToTemplate(null).ok).toBe(false);
    const noImage = eggToTemplate({ ...paper, docker_images: {} });
    expect(noImage.ok ? null : noImage.error).toBe("Egg has no docker image");
  });
});

test("nextFreeName", () => {
  expect(nextFreeName("Paper", ["Vanilla"])).toBe("Paper");
  expect(nextFreeName("Paper", ["Paper"])).toBe("Paper (2)");
  expect(nextFreeName("Paper", ["Paper", "Paper (2)"])).toBe("Paper (3)");
  expect(nextFreeName("Paper (2)", ["Paper (2)"])).toBe("Paper (3)");
});

test("unknown features, unsupported rules and invalid defaults are reported", () => {
  const r = eggToTemplate({
    ...paper,
    features: ["eula", "gsl_token"],
    variables: [
      { name: "Port", env_variable: "QPORT", default_value: "abc", user_viewable: true, user_editable: true, rules: "required|integer|exists:users,id" },
      { name: "Re", env_variable: "RE", default_value: "x", user_viewable: true, user_editable: true, rules: "regex:/a/x" },
    ],
  });
  if (!r.ok) throw new Error(r.error);
  expect(r.template.features).toEqual(["eula"]);
  expect(r.warnings).toContain("Egg feature(s) gsl_token aren't supported by the panel and were ignored.");
  expect(r.warnings).toContain("QPORT: rule(s) exists aren't supported and won't be checked.");
  expect(r.warnings).toContain("Default of QPORT must be a whole number. Servers will need their own value.");
  expect(r.warnings).toContain("RE: regex:/a/x can't be used in the panel and won't be checked.");
});
