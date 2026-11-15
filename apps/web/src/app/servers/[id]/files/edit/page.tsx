"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vango-panel/ui/components/button";
import { Skeleton } from "@vango-panel/ui/components/skeleton";
import { basename, languageFor, normalizePath, parentDir } from "@vango-panel/wings/paths";
import { ArrowLeft, Download, Save } from "lucide-react";
import type { Route } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/utils/trpc";

import { can, useServerShell } from "../../server-shell";

const CodeEditor = dynamic(() => import("./code-editor"), {
  ssr: false,
  loading: () => <Skeleton className="h-[calc(100svh-18rem)] min-h-80" />,
});

export default function EditFilePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Editor />
    </Suspense>
  );
}

function Editor() {
  const { server } = useServerShell();
  const params = useSearchParams();
  const file = normalizePath(params.get("file") ?? "/");
  const isNew = params.get("new") === "1";
  const read = useQuery({
    ...trpc.servers.files.read.queryOptions({ id: server.id, file }),
    enabled: !isNew && file !== "/",
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (file === "/") return <p className="text-destructive text-sm">No file given.</p>;
  if (!isNew && read.isPending) return <Skeleton className="h-96" />;
  return (
    <EditorBody
      key={`${file}:${isNew}`}
      file={file}
      isNew={isNew}
      initial={isNew ? "" : (read.data?.content ?? "")}
      loadError={!isNew && read.isError ? read.error.message : null}
      canWrite={can(server.permissions, isNew ? "file.create" : "file.update")}
    />
  );
}

function EditorBody({
  file,
  isNew,
  initial,
  loadError,
  canWrite,
}: {
  file: string;
  isNew: boolean;
  initial: string;
  loadError: string | null;
  canWrite: boolean;
}) {
  const { server } = useServerShell();
  const router = useRouter();
  const qc = useQueryClient();
  const [content, setContent] = useState(initial);
  const [saved, setSaved] = useState(isNew ? null : initial);
  const dirty = saved === null ? content !== "" || isNew : content !== saved;
  const dir = parentDir(file);
  const backHref = `/servers/${server.id}/files?dir=${encodeURIComponent(dir)}` as Route;

  const write = useMutation(
    trpc.servers.files.write.mutationOptions({
      onSuccess: async () => {
        setSaved(content);
        toast.success(`Saved ${basename(file)}`);
        qc.setQueryData(trpc.servers.files.read.queryKey({ id: server.id, file }), { file, content });
        await qc.invalidateQueries({ queryKey: trpc.servers.files.list.queryKey({ id: server.id, directory: dir }) });
        if (isNew) router.replace(`/servers/${server.id}/files/edit?file=${encodeURIComponent(file)}` as Route);
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const download = useMutation(trpc.servers.files.downloadUrl.mutationOptions({ onError: (e) => toast.error(e.message) }));

  const save = () => {
    if (!canWrite || write.isPending || loadError) return;
    write.mutate({ id: server.id, file, content, create: isNew });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
    };
  });

  const startDownload = async () => {
    const { url } = await download.mutateAsync({ id: server.id, file });
    window.location.assign(url);
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
            onClick={(e) => {
              if (dirty && !confirm("Discard unsaved changes?")) e.preventDefault();
            }}
          >
            <ArrowLeft className="size-4" /> Files
          </Link>
          <span className="truncate font-mono text-sm">{file}</span>
          {isNew ? <span className="text-muted-foreground text-xs">(new file)</span> : null}
          {dirty && !loadError ? <span className="text-xs text-yellow-600 dark:text-yellow-400">● unsaved</span> : null}
        </div>
        <div className="flex gap-2">
          {!isNew && can(server.permissions, "file.read-content") ? (
            <Button variant="outline" size="sm" onClick={() => void startDownload()}>
              <Download /> Download
            </Button>
          ) : null}
          {canWrite && !loadError ? (
            <Button size="sm" onClick={save} disabled={write.isPending || (!dirty && !isNew)} title="Ctrl+S">
              <Save /> {write.isPending ? "Saving…" : isNew ? "Create" : "Save"}
            </Button>
          ) : null}
        </div>
      </div>
      {loadError ? (
        <div className="grid gap-2 p-4 ring-1 ring-destructive/30">
          <p className="text-destructive text-sm">{loadError}</p>
        </div>
      ) : (
        <>
          {!canWrite ? <p className="text-muted-foreground text-xs">Read-only: you can't change files on this server.</p> : null}
          <CodeEditor value={content} onChange={setContent} language={languageFor(basename(file))} readOnly={!canWrite} />
        </>
      )}
    </div>
  );
}
