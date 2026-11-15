import { auth } from "@vango-panel/auth";
import type { NextRequest } from "next/server";

export async function createContext(req: NextRequest) {
  const session = await auth.api.getSession({
    headers: req.headers,
  });
  return {
    auth: null,
    session,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
