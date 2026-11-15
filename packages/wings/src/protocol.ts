import { z } from "zod";

export interface ConfigurationReplacement {
  match: string;
  if_value?: string | null;
  replace_with: unknown;
}

export interface ConfigurationFile {
  file: string;
  parser: string;
  replace: ConfigurationReplacement[];
}

export interface ServerConfiguration {
  settings: {
    uuid: string;
    meta: { name: string; description: string };
    suspended: boolean;
    invocation: string;
    skip_egg_scripts: boolean;
    environment: Record<string, unknown>;
    allocations: {
      force_outgoing_ip: boolean;
      default: { ip: string; port: number };
      mappings: Record<string, number[]>;
    };
    build: {
      memory_limit: number;
      swap: number;
      io_weight: number;
      cpu_limit: number;
      threads: string | null;
      disk_space: number;
      oom_disabled: boolean;
    };
    crash_detection_enabled: boolean;
    mounts: { source: string; target: string; read_only: boolean }[];
    egg: { id: string; file_denylist: string[] };
    container: { image: string; requires_rebuild?: boolean };
  };
  process_configuration: {
    startup: { done: string[]; user_interaction: string[]; strip_ansi: boolean };
    stop: { type: string; value: string };
    configs: ConfigurationFile[];
  };
}

export interface InstallationScript {
  container_image: string;
  entrypoint: string;
  script: string;
}

export const configurationFileSchema = z.object({
  file: z.string().min(1),
  parser: z.enum(["properties", "file", "yaml", "json", "toml", "ini", "xml"]),
  replace: z
    .array(
      z.object({
        match: z.string().min(1),
        if_value: z.string().nullish(),
        replace_with: z.unknown(),
      }),
    )
    .default([]),
});

export const powerStateSchema = z.enum(["offline", "starting", "running", "stopping"]);
export type PowerState = z.infer<typeof powerStateSchema>;

export const powerActionSchema = z.enum(["start", "stop", "restart", "kill"]);
export type PowerAction = z.infer<typeof powerActionSchema>;

export const resourceUsageSchema = z.object({
  memory_bytes: z.number(),
  memory_limit_bytes: z.number(),
  cpu_absolute: z.number(),
  network: z.object({ rx_bytes: z.number(), tx_bytes: z.number() }),
  uptime: z.number(),
  state: powerStateSchema,
  disk_bytes: z.number(),
});
export type ResourceUsage = z.infer<typeof resourceUsageSchema>;

export const serverDetailsSchema = z.object({
  uuid: z.string(),
  state: powerStateSchema,
  is_suspended: z.boolean(),
  is_installing: z.boolean(),
  is_transferring: z.boolean(),
  is_restoring: z.boolean(),
  utilization: resourceUsageSchema,
});
export type ServerDetails = z.infer<typeof serverDetailsSchema>;

export const systemInfoSchema = z.object({
  version: z.string(),
  architecture: z.string(),
  os: z.string(),
  kernel_version: z.string(),
  os_name: z.string(),
  cpu_count: z.number(),
  memory_bytes: z.number(),
  docker_version: z.string().nullable(),
  servers: z.number(),
  uptime_seconds: z.number(),
});
export type SystemInfo = z.infer<typeof systemInfoSchema>;

export const installStatusSchema = z.object({
  successful: z.boolean(),
  reinstall: z.boolean().default(false),
});

export const stateReportBatchSchema = z.object({
  data: z.array(
    z.object({
      uuid: z.string(),
      state: z.string(),
      is_installing: z.boolean(),
      is_transferring: z.boolean(),
      is_restoring: z.boolean(),
      utilization: z.unknown(),
    }),
  ),
});

export const serverEventReportSchema = z.object({
  event: z.string(),
  exit_code: z.number().nullable().optional(),
  oom_killed: z.boolean(),
  restarting: z.boolean(),
  timestamp: z.string(),
});

export const activityBatchSchema = z.object({
  data: z.array(
    z.object({
      user: z.string().nullable().optional(),
      server: z.string(),
      event: z.string(),
      metadata: z.unknown(),
      ip: z.string().nullable().optional(),
      timestamp: z.string(),
    }),
  ),
});

export const fileStatSchema = z.object({
  name: z.string(),
  created: z.string(),
  modified: z.string(),
  mode: z.string(),
  mode_bits: z.string(),
  size: z.number(),
  directory: z.boolean(),
  file: z.boolean(),
  symlink: z.boolean(),
  mime: z.string(),
});
export type FileStat = z.infer<typeof fileStatSchema>;
