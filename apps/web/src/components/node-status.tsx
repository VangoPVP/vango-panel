"use client";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

export function NodeStatus({ id }: { id: string }) {
  const sys = useQuery({ ...trpc.admin.nodes.system.queryOptions({ id }), refetchInterval: 30_000 });
  if (sys.isPending) return <span className="text-muted-foreground">checking…</span>;
  if (sys.isError) return <span className="text-destructive">error</span>;
  return sys.data.online ? (
    <span className="text-green-600 dark:text-green-400">online · wings {sys.data.info.version}</span>
  ) : (
    <span className="text-destructive" title={sys.data.error}>
      offline
    </span>
  );
}
