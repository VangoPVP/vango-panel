import { z } from "zod";

import { type EggFeature, isEggFeature } from "./features";
import type { ConfigurationFile, ConfigurationReplacement } from "./protocol";
import { parseRules, validateValue } from "./rules";

export const CONFIG_PARSERS = ["properties", "file", "yaml", "json", "toml", "ini", "xml"] as const;

const VAR_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
const NAME_MAX = 64;
const DEFAULT_INSTALL_IMAGE = "ghcr.io/pterodactyl/installers:alpine";

export interface ImportedVariable {
  key: string;
  name: string;
  description: string;
  default: string;
  userEditable: boolean;
  rules: string;
}

export interface ImportedTemplate {
  name: string;
  description: string;
  image: string;
  dockerImages: Record<string, string>;
  startup: string;
  stopType: "command" | "signal" | "stop";
  stopValue: string;
  startupDone: string[];
  stripAnsi: boolean;
  configFiles: ConfigurationFile[];
  fileDenylist: string[];
  installImage: string;
  installEntrypoint: string;
  installScript: string;
  variables: ImportedVariable[];
  features: EggFeature[];
}

export type EggImportResult =
  | { ok: true; template: ImportedTemplate; warnings: string[]; author: string | null; version: string | null }
  | { ok: false; error: string };

const boolish = z.union([z.boolean(), z.number(), z.string()]).nullish();
const toBool = (v: z.infer<typeof boolish>) => v === true || v === 1 || v === "1" || v === "true";

const jsonish = z.union([z.string(), z.record(z.string(), z.unknown())]).nullish();

const eggSchema = z.object({
  meta: z.object({ version: z.string().nullish() }).partial().nullish(),
  name: z.string().trim().min(1, "egg has no name"),
  author: z.string().nullish(),
  description: z.string().nullish(),
  features: z.array(z.string()).nullish(),
  docker_images: z.union([z.record(z.string(), z.string()), z.array(z.string())]).nullish(),
  image: z.string().nullish(),
  file_denylist: z.array(z.string()).nullish(),
  startup: z.string().min(1, "egg has no startup command"),
  config: z
    .object({
      files: jsonish,
      startup: jsonish,
      logs: jsonish,
      stop: z.string().nullish(),
      extends: z.union([z.string(), z.number()]).nullish(),
    })
    .partial()
    .nullish(),
  scripts: z
    .object({
      installation: z
        .object({ script: z.string().nullish(), container: z.string().nullish(), entrypoint: z.string().nullish() })
        .partial()
        .nullish(),
    })
    .partial()
    .nullish(),
  variables: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().nullish(),
        env_variable: z.string(),
        default_value: z.union([z.string(), z.number(), z.boolean()]).nullish(),
        user_viewable: boolish,
        user_editable: boolish,
        rules: z.union([z.string(), z.array(z.string())]).nullish(),
      }),
    )
    .nullish(),
});

function parseJsonish(v: z.infer<typeof jsonish>, what: string, warnings: string[]): Record<string, unknown> {
  if (v == null || v === "") return {};
  if (typeof v !== "string") return v;
  try {
    const parsed: unknown = JSON.parse(v);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    if (Array.isArray(parsed) && parsed.length === 0) return {};
    warnings.push(`${what} is not a JSON object; ignored.`);
  } catch {
    warnings.push(`${what} is not valid JSON; ignored.`);
  }
  return {};
}

const LEGACY_PLACEHOLDERS: [RegExp, string][] = [
  [/\{\{\s*config\.docker\.interface\s*\}\}/g, "{{config.docker.network.interface}}"],
];

function normalizePlaceholders<T>(v: T, warnings: Set<string>): T {
  if (typeof v !== "string") return v;
  let out: string = v;
  for (const [re, to] of LEGACY_PLACEHOLDERS) {
    if (re.test(out)) {
      warnings.add(`Rewrote legacy placeholder to ${to}.`);
      out = out.replace(re, to);
    }
  }
  return out as T;
}

function convertConfigFiles(raw: Record<string, unknown>, warnings: string[]): ConfigurationFile[] {
  const out: ConfigurationFile[] = [];
  const notes = new Set<string>();
  for (const [file, spec] of Object.entries(raw)) {
    if (!spec || typeof spec !== "object") {
      warnings.push(`Config file "${file}" has no parser/find block; skipped.`);
      continue;
    }
    const { parser: rawParser, find } = spec as { parser?: unknown; find?: unknown };
    const parser = String(rawParser ?? "").toLowerCase();
    if (!(CONFIG_PARSERS as readonly string[]).includes(parser)) {
      warnings.push(`Config file "${file}" uses unsupported parser "${String(rawParser)}"; skipped.`);
      continue;
    }
    const replace: ConfigurationReplacement[] = [];
    if (find && typeof find === "object") {
      for (const [match, value] of Object.entries(find as Record<string, unknown>)) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          for (const [ifValue, replacement] of Object.entries(value as Record<string, unknown>)) {
            replace.push({ match, if_value: ifValue, replace_with: normalizePlaceholders(replacement, notes) });
          }
        } else {
          replace.push({ match, replace_with: normalizePlaceholders(value, notes) });
        }
      }
    }
    out.push({ file, parser, replace });
  }
  warnings.push(...notes);
  return out;
}

function convertStop(stop: string | null | undefined, warnings: string[]): Pick<ImportedTemplate, "stopType" | "stopValue"> {
  const s = (stop ?? "").trim();
  if (!s) return { stopType: "stop", stopValue: "" };
  if (s.startsWith("^")) {
    if (s.toUpperCase() === "^C") return { stopType: "signal", stopValue: "SIGINT" };
    warnings.push(`Stop signal "${s}" passed to wings as-is; check it stops the server.`);
    return { stopType: "signal", stopValue: s };
  }
  return { stopType: "command", stopValue: s };
}

function convertDone(raw: Record<string, unknown>): string[] {
  const done = raw.done;
  if (typeof done === "string") return done ? [done] : [];
  if (Array.isArray(done)) return done.filter((d): d is string => typeof d === "string" && d.length > 0);
  return [];
}

function convertImages(
  egg: z.infer<typeof eggSchema>,
): { image: string; dockerImages: Record<string, string> } | null {
  let images: Record<string, string> = {};
  if (Array.isArray(egg.docker_images)) {
    for (const img of egg.docker_images) if (img) images[img] = img;
  } else if (egg.docker_images) {
    images = Object.fromEntries(Object.entries(egg.docker_images).filter(([, v]) => v));
  }
  if (!Object.keys(images).length && egg.image) images = { [egg.image]: egg.image };
  const first = Object.values(images)[0];
  return first ? { image: first, dockerImages: images } : null;
}

export function eggToTemplate(input: unknown): EggImportResult {
  const parsed = eggSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Not a valid egg: ${issue?.path.join(".") || "root"}: ${issue?.message}` };
  }
  const egg = parsed.data;
  const warnings: string[] = [];

  const version = egg.meta?.version ?? null;
  if (version && !/^(PTDL|PLCN)_v\d+$/.test(version)) {
    warnings.push(`Unknown egg format "${version}"; imported on a best-effort basis.`);
  }

  const images = convertImages(egg);
  if (!images) return { ok: false, error: "Egg has no docker image" };

  let name = egg.name.trim();
  if (name.length > NAME_MAX) {
    name = name.slice(0, NAME_MAX).trim();
    warnings.push(`Name shortened to ${NAME_MAX} characters.`);
  }

  const config = egg.config ?? {};
  if (config.extends != null && config.extends !== "") {
    warnings.push(
      "This egg inherits its config from another egg (config.extends), which can't be resolved here. Check stop/startup/config files.",
    );
  }
  const stop = convertStop(config.stop, warnings);
  const startupDone = convertDone(parseJsonish(config.startup, "config.startup", warnings));
  const configFiles = convertConfigFiles(parseJsonish(config.files, "config.files", warnings), warnings);

  const install = egg.scripts?.installation ?? {};
  const installScript = (install.script ?? "").replace(/\r\n/g, "\n");
  let installImage = install.container?.trim() || "";
  if (installScript.trim() && !installImage) {
    installImage = DEFAULT_INSTALL_IMAGE;
    warnings.push(`No install container given; using ${DEFAULT_INSTALL_IMAGE}.`);
  }

  const variables: ImportedVariable[] = [];
  const seen = new Set<string>();
  for (const v of egg.variables ?? []) {
    const key = v.env_variable.trim();
    if (!VAR_KEY_RE.test(key)) {
      warnings.push(`Variable "${key}" isn't a valid UPPER_SNAKE_CASE name; skipped.`);
      continue;
    }
    if (seen.has(key)) {
      warnings.push(`Duplicate variable ${key}; kept the first.`);
      continue;
    }
    seen.add(key);
    const rules = Array.isArray(v.rules) ? v.rules.join("|") : (v.rules ?? "");
    const parsedRules = parseRules(rules);
    if (parsedRules.unsupported.length) {
      warnings.push(`${key}: rule(s) ${parsedRules.unsupported.join(", ")} aren't supported and won't be checked.`);
    }
    if (parsedRules.invalid.length) {
      warnings.push(`${key}: ${parsedRules.invalid.join(", ")} can't be used in the panel and won't be checked.`);
    }
    const def = v.default_value == null ? "" : String(v.default_value);
    const defError = validateValue(key, def, parsedRules);
    if (defError) warnings.push(`Default of ${defError} Servers will need their own value.`);
    variables.push({
      key,
      name: v.name.trim() || key,
      description: v.description ?? "",
      default: def,
      userEditable: toBool(v.user_editable) && (v.user_viewable == null || toBool(v.user_viewable)),
      rules,
    });
  }
  const features = (egg.features ?? []).filter(isEggFeature);
  const unknownFeatures = (egg.features ?? []).filter((f) => !isEggFeature(f));
  if (unknownFeatures.length) {
    warnings.push(`Egg feature(s) ${unknownFeatures.join(", ")} aren't supported by the panel and were ignored.`);
  }

  return {
    ok: true,
    author: egg.author ?? null,
    version,
    warnings,
    template: {
      name,
      description: (egg.description ?? "").slice(0, 1000),
      image: images.image,
      dockerImages: images.dockerImages,
      startup: egg.startup,
      ...stop,
      startupDone,
      stripAnsi: true,
      configFiles,
      fileDenylist: egg.file_denylist ?? [],
      installImage: installImage || "busybox:latest",
      installEntrypoint: install.entrypoint?.trim() || "bash",
      installScript,
      variables,
      features: [...new Set(features)],
    },
  };
}

export function nextFreeName(name: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(name)) return name;
  const base = name.replace(/ \(\d+\)$/, "").slice(0, NAME_MAX - 6);
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!set.has(candidate)) return candidate;
  }
}
