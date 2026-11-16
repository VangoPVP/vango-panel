"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@vango-panel/ui/components/sonner";
import dynamic from "next/dynamic";

import { queryClient } from "@/utils/trpc";

import { ThemeProvider } from "./theme-provider";

// Devtools are dev-only: in production builds this branch is dead code, so the chunk is never shipped.
const ReactQueryDevtools =
  process.env.NODE_ENV === "development"
    ? dynamic(() => import("@tanstack/react-query-devtools").then((m) => m.ReactQueryDevtools), {
        ssr: false,
      })
    : () => null;

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        {children}
        <ReactQueryDevtools />
      </QueryClientProvider>
      <Toaster richColors />
    </ThemeProvider>
  );
}
