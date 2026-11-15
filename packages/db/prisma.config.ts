import path from "node:path";

import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

dotenv.config({
  path: path.join(import.meta.dirname, "../../apps/web/.env"),
  quiet: true,
});

// `prisma generate` doesn't need a database, so don't fail when DATABASE_URL is missing
// (e.g. `bun install` on a fresh clone before apps/web/.env exists). Commands that do need
// it (db push / migrate / studio) will still error out without it.
const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: path.join("prisma", "schema"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  ...(url ? { datasource: { url } } : {}),
});
