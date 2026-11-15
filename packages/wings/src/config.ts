import type { Allocation, Server, Template } from "@vango-panel/db";
import { z } from "zod";

import {
  type ConfigurationFile,
  configurationFileSchema,
  type InstallationScript,
  type ServerConfiguration,
} from "./protocol";

export const templateVariableSchema = z.object({
  key: z
    .string()
    .regex(/^[A-Z_][A-Z0-9_]*$/, "use UPPER_SNAKE_CASE"),
  name: z.string().min(1),
  description: z.string().default(""),
  default: z.string().default(""),
  userEditable: z.boolean().default(false),
  rules: z.string().max(2000).default(""),
});
export type TemplateVariable = z.infer<typeof templateVariableSchema>;

export function parseTemplateVariables(json: unknown): TemplateVariable[] {
  const r = z.array(templateVariableSchema).safeParse(json);
  return r.success ? r.data : [];
}

export function parseDockerImages(json: unknown, fallbackImage: string): Record<string, string> {
  const r = z.record(z.string(), z.string().min(1)).safeParse(json);
  return r.success && Object.keys(r.data).length ? r.data : { [fallbackImage]: fallbackImage };
}

export function parseConfigFiles(json: unknown): ConfigurationFile[] {
  const r = z.array(configurationFileSchema).safeParse(json);
  return r.success ? (r.data as ConfigurationFile[]) : [];
}

export type ServerWithRelations = Server & {
  template: Template;
  allocations: Allocation[];
  defaultAllocation: Allocation | null;
};

export const serverConfigInclude = {
  template: true,
  allocations: true,
  defaultAllocation: true,
} as const;

export function resolveEnvironment(server: ServerWithRelations): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of parseTemplateVariables(server.template.variables)) out[v.key] = v.default;
  const own = server.environment;
  if (own && typeof own === "object" && !Array.isArray(own)) {
    for (const [k, v] of Object.entries(own)) {
      if (v !== null && v !== undefined) out[k] = String(v);
    }
  }
  return out;
}

export function renderStartup(startup: string, vars: Record<string, string>): string {
  return startup.replace(/\{\{\s*(?:env\.)?([A-Za-z0-9_]+)\s*\}\}/g, (whole, name: string) =>
    name in vars ? (vars[name] as string) : whole,
  );
}

export function startupVariables(server: ServerWithRelations, env = resolveEnvironment(server)): Record<string, string> {
  const def = server.defaultAllocation ?? server.allocations[0] ?? null;
  return {
    ...env,
    SERVER_MEMORY: String(server.memoryMib),
    SERVER_IP: def?.ip ?? "0.0.0.0",
    SERVER_PORT: String(def?.port ?? 0),
  };
}

export function renderedStartup(server: ServerWithRelations, masked: ReadonlySet<string> = new Set()): string {
  const vars = startupVariables(server);
  for (const k of masked) if (k in vars) vars[k] = "[hidden]";
  return renderStartup(server.startup, vars);
}

export function buildServerConfiguration(server: ServerWithRelations): ServerConfiguration {
  const t = server.template;
  const env = resolveEnvironment(server);
  const def = server.defaultAllocation ?? server.allocations[0] ?? null;

  const mappings: Record<string, number[]> = {};
  for (const a of server.allocations) {
    mappings[a.ip] = [...(mappings[a.ip] ?? []), a.port];
  }
  for (const ports of Object.values(mappings)) ports.sort((x, y) => x - y);

  const startupVars = startupVariables(server, env);

  return {
    settings: {
      uuid: server.id,
      meta: { name: server.name, description: server.description },
      suspended: server.suspended,
      invocation: renderStartup(server.startup, startupVars),
      skip_egg_scripts: server.skipInstall || t.installScript.trim() === "",
      environment: env,
      allocations: {
        force_outgoing_ip: false,
        default: { ip: def?.ip ?? "0.0.0.0", port: def?.port ?? 0 },
        mappings,
      },
      build: {
        memory_limit: server.memoryMib,
        swap: server.swapMib,
        io_weight: server.ioWeight,
        cpu_limit: server.cpuPercent,
        threads: server.threads || null,
        disk_space: server.diskMib,
        oom_disabled: server.oomDisabled,
      },
      crash_detection_enabled: true,
      mounts: [],
      egg: { id: t.id, file_denylist: t.fileDenylist },
      container: { image: server.image },
    },
    process_configuration: {
      startup: { done: t.startupDone, user_interaction: [], strip_ansi: t.stripAnsi },
      stop: { type: t.stopType, value: t.stopValue },
      configs: parseConfigFiles(t.configFiles),
    },
  };
}

export function buildInstallationScript(template: Template): InstallationScript {
  return {
    container_image: template.installImage,
    entrypoint: template.installEntrypoint,
    script: template.installScript,
  };
}
