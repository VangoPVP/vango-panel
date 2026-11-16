import "@vango-panel/env/web";
import type { NextConfig } from "next";

// Hostnames the panel is served from besides localhost (e.g. a NetBird reverse-proxy domain).
// `next dev` blocks dev assets/HMR for any other origin, which leaves the page un-hydrated.
const panelHosts = [process.env.BETTER_AUTH_URL, ...(process.env.CORS_ORIGIN ?? "").split(",")]
  .map((u) => {
    try {
      return u ? new URL(u.trim()).hostname : null;
    } catch {
      return null;
    }
  })
  .filter((h): h is string => !!h);

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  allowedDevOrigins: [...new Set(panelHosts)],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
