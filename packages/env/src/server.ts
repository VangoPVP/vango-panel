import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/** Comma-separated list of http(s) origins, e.g. "http://localhost:3001,https://panel.example.netbird.io". */
const originList = z
  .string()
  .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean))
  .pipe(z.array(z.url({ protocol: /^https?$/ }).transform((u) => new URL(u).origin)).min(1));

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    /** Public URL users open the panel at (e.g. the NetBird reverse-proxy URL). */
    BETTER_AUTH_URL: z.url(),
    /** Extra browser origins allowed to use the panel (comma-separated). */
    CORS_ORIGIN: originList,
    /**
     * How wings daemons reach the panel's /api/remote, written to config.yml as `remote`.
     * Defaults to BETTER_AUTH_URL. Set it to a direct/internal URL (e.g. the panel's NetBird IP)
     * when the public URL sits behind proxy auth (SSO/PIN/password) that wings can't pass.
     */
    PANEL_REMOTE_URL: z.url({ protocol: /^https?$/ }).optional(),
    /** Who must use two-factor authentication: nobody, admins (default) or everyone. */
    PANEL_REQUIRE_2FA: z.enum(["none", "admins", "all"]).default("admins"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    /**
     * Public URL of the phpMyAdmin container (deploy/phpmyadmin), e.g. http://192.168.2.108:8081.
     * The Databases tab shows a "phpMyAdmin" button only when this and the secret are set.
     */
    PHPMYADMIN_URL: z.url({ protocol: /^https?$/ }).optional(),
    /** Shared with phpMyAdmin's vango-signon.php, which uses it to redeem one-time login tokens. */
    PHPMYADMIN_SIGNON_SECRET: z.string().min(32).optional(),
    PANEL_APP_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "must be base64 of exactly 32 bytes"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

/** Every origin browsers may load the panel from: BETTER_AUTH_URL plus CORS_ORIGIN. */
export function panelOrigins(): string[] {
  return [...new Set([new URL(env.BETTER_AUTH_URL).origin, ...env.CORS_ORIGIN])];
}
