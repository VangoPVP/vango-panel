import { describe, expect, test } from "bun:test";

import { guessJavaImage, javaVersionOf, matchFeature, parseJavaRequirement, pickJavaImage } from "./features";
import { parseRules, phpRegex, validateValue, validateVariables } from "./rules";

const ok = (value: string, rules: string) => validateValue("X", value, rules);

describe("parseRules", () => {
  test("splits rules and arguments", () => {
    const p = parseRules("required|string|between:1,20|in:a,b");
    expect(p.rules.map((r) => [r.name, r.args])).toEqual([
      ["required", []],
      ["string", []],
      ["between", ["1", "20"]],
      ["in", ["a", "b"]],
    ]);
    expect(p.unsupported).toEqual([]);
  });

  test("a | inside a regex doesn't split the rule", () => {
    const p = parseRules("required|regex:/^(true|false|maybe)$/i|max:10");
    expect(p.rules.map((r) => r.name)).toEqual(["required", "regex", "max"]);
    expect(p.rules[1]?.args).toEqual(["/^(true|false|maybe)$/i"]);
    expect(p.rules[1]?.regex?.test("TRUE")).toBe(true);
  });

  test("unsupported and invalid rules are reported, not applied", () => {
    const p = parseRules("required|exists:users,id|max:abc|regex:/a/x|regex:/(unclosed/");
    expect(p.unsupported).toEqual(["exists"]);
    expect(p.invalid).toEqual(["max:abc", "regex:/a/x", "regex:/(unclosed/"]);
    expect(p.rules.map((r) => r.name)).toEqual(["required"]);
  });

  test("php delimiters and flags", () => {
    expect(phpRegex("#^a/b$#")?.test("a/b")).toBe(true);
    expect(phpRegex("/a\\/b/")?.test("a/b")).toBe(true);
    expect(phpRegex("/abc/D")?.test("abc")).toBe(true);
    expect(phpRegex("/abc/U")).toBeNull();
    expect(phpRegex("/abc")).toBeNull();
  });
});

describe("validateValue", () => {
  test("empty values only fail required", () => {
    expect(ok("", "required")).toBe("X is required.");
    expect(ok("  ", "required|string")).toBe("X is required.");
    expect(ok("", "nullable|integer|min:5")).toBeNull();
    expect(ok("", "integer|min:5")).toBeNull();
  });

  test("min/max: length for strings, value for numbers", () => {
    expect(ok("abcd", "string|max:3")).toBe("X must be at most 3 characters.");
    expect(ok("abc", "string|max:3")).toBeNull();
    expect(ok("100", "integer|max:3")).toBe("X must be at most 3.");
    expect(ok("2", "integer|max:3")).toBeNull();
    expect(ok("1.5", "numeric|between:1,2")).toBeNull();
    expect(ok("ab", "between:3,5")).toBe("X must be between 3 and 5 characters.");
    expect(ok("æøå", "size:3")).toBeNull();
  });

  test("types", () => {
    expect(ok("12a", "integer")).toBe("X must be a whole number.");
    expect(ok("-12", "integer")).toBeNull();
    expect(ok("1e3", "numeric")).toBeNull();
    expect(ok("yes", "boolean")).toBe("X must be true/false (or 1/0).");
    expect(ok("0", "boolean")).toBeNull();
    expect(ok("a_b-1", "alpha_dash")).toBeNull();
    expect(ok("a b", "alpha_num")).not.toBeNull();
    expect(ok("https://example.com/x", "url")).toBeNull();
    expect(ok("not a url", "url")).not.toBeNull();
    expect(ok("10.0.0.1", "ip")).toBeNull();
    expect(ok("::1", "ip")).toBeNull();
    expect(ok("300.0.0.1", "ip")).not.toBeNull();
    expect(ok("0123", "digits:4")).toBeNull();
    expect(ok("012", "digits_between:4,6")).not.toBeNull();
  });

  test("in / regex / starts_with", () => {
    expect(ok("c", "in:a,b")).toBe("X must be one of: a, b.");
    expect(ok("server.jar", "required|regex:/^([\\w\\d._-]+)(\\.jar)$/")).toBeNull();
    expect(ok("server.zip", "required|regex:/^([\\w\\d._-]+)(\\.jar)$/")).toBe("X has an invalid format.");
    expect(ok("abc", "not_regex:/b/")).toBe("X has an invalid format.");
    expect(ok("v1.2", "starts_with:v,r")).toBeNull();
  });

  test("unknown rules don't block", () => {
    expect(ok("anything", "exists:users,id")).toBeNull();
  });
});

test("validateVariables uses own value, else default", () => {
  const vars = [
    { key: "JAR", name: "Jar", default: "server.jar", rules: "required|regex:/\\.jar$/" },
    { key: "VER", name: "Version", default: "", rules: "required" },
    { key: "FREE", name: "Free", default: "" },
  ];
  expect(validateVariables(vars, { VER: "1.21" })).toEqual({});
  expect(validateVariables(vars, { JAR: "x.zip" })).toEqual({
    JAR: "Jar has an invalid format.",
    VER: "Version is required.",
  });
});

test("matchFeature only fires for enabled features", () => {
  const eula = "[12:00:00] [main/WARN]: You need to agree to the EULA in order to run the server. Go to eula.txt for more info.";
  expect(matchFeature(eula, ["eula"])).toBe("eula");
  expect(matchFeature(eula, ["java_version"])).toBeNull();
  expect(
    matchFeature(
      "Error: LinkageError occurred while loading main class io.papermc.paperclip.Main\njava.lang.UnsupportedClassVersionError: ...",
      ["eula", "java_version"],
    ),
  ).toBe("java_version");
  expect(matchFeature("java.lang.OutOfMemoryError: unable to create native thread", ["pid_limit"])).toBe("pid_limit");
  expect(matchFeature("Done (3.2s)!", ["eula", "java_version", "pid_limit"])).toBeNull();
});

describe("java version helper", () => {
  const velocityError =
    "java.lang.UnsupportedClassVersionError: com/velocitypowered/proxy/Velocity has been compiled by a more recent version of the Java Runtime (class file version 69.0), this version of the Java Runtime only recognizes class file versions up to 66.0";
  const images = {
    "Java 8": "ghcr.io/ptero-eggs/yolks:java_8",
    "Java 17": "ghcr.io/ptero-eggs/yolks:java_17",
    "Java 21": "ghcr.io/ptero-eggs/yolks:java_21",
    "Java 22": "ghcr.io/ptero-eggs/yolks:java_22",
  };

  test("reads required/current Java from the error", () => {
    expect(parseJavaRequirement(["Error: LinkageError occurred", velocityError])).toEqual({ required: 25, current: 22 });
    expect(parseJavaRequirement(["Minecraft 1.18 requires running the server with Java 17 or above."])).toEqual({
      required: 17,
      current: null,
    });
    expect(parseJavaRequirement(["Unsupported major.minor version 52.0"])).toEqual({ required: 8, current: null });
    expect(parseJavaRequirement(["Done (1.2s)!"])).toEqual({ required: null, current: null });
  });

  test("picks the lowest image that is new enough", () => {
    expect(pickJavaImage(images, 17)).toEqual({ label: "Java 17", image: "ghcr.io/ptero-eggs/yolks:java_17", version: 17 });
    expect(pickJavaImage(images, 18)?.version).toBe(21);
    expect(pickJavaImage(images, 25)).toBeNull();
    expect(javaVersionOf("Temurin", "eclipse-temurin:21-jre")).toBeNull();
    expect(javaVersionOf("Java 21", "custom/image:latest")).toBe(21);
  });

  test("guesses the missing image from the template's naming", () => {
    expect(guessJavaImage(images, 25)).toBe("ghcr.io/ptero-eggs/yolks:java_25");
    expect(guessJavaImage({ Default: "wings-test-yolk" }, 25)).toBeNull();
  });
});
