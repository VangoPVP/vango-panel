"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vango-panel/ui/components/button";
import { Checkbox } from "@vango-panel/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vango-panel/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@vango-panel/ui/components/dropdown-menu";
import { Input } from "@vango-panel/ui/components/input";
import { Skeleton } from "@vango-panel/ui/components/skeleton";
import { cn } from "@vango-panel/ui/lib/utils";
import {
  breadcrumbs,
  isArchive,
  isEditable,
  isValidMode,
  isValidName,
  joinPath,
  normalizePath,
  parentDir,
} from "@vango-panel/wings/paths";
import type { FileStat } from "@vango-panel/wings/protocol";
import {
  Download,
  FileArchive,
  FileCode,
  File as FileIcon,
  FilePlus,
  Folder,
  FolderPlus,
  Link2,
  MoreHorizontal,
  Upload,
} from "lucide-react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { toast } from "sonner";

import { formatBytes } from "@/lib/format";
import { uploadFile } from "@/lib/upload";
import { trpc } from "@/utils/trpc";

import { can, useServerShell } from "../server-shell";

export default function FilesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <FileManager />
    </Suspense>
  );
}

type Modal =
  | { kind: "mkdir" }
  | { kind: "newfile" }
  | { kind: "pull" }
  | { kind: "rename"; file: FileStat }
  | { kind: "move"; names: string[] }
  | { kind: "chmod"; file: FileStat }
  | { kind: "delete"; names: string[] }
  | { kind: "archive"; names: string[] };

type UploadRow = { key: number; name: string; done: number; total: number; error?: string; finished?: boolean };

function formatDate(s: string) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
}

function FileManager() {
  const { server } = useServerShell();
  const perms = server.permissions;
  const router = useRouter();
  const params = useSearchParams();
  const dir = normalizePath(params.get("dir") ?? "/");
  const qc = useQueryClient();
  const listKey = trpc.servers.files.list.queryKey({ id: server.id, directory: dir });
  const list = useQuery(trpc.servers.files.list.queryOptions({ id: server.id, directory: dir }));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<Modal | null>(null);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadKey = useRef(0);

  const refresh = () => qc.invalidateQueries({ queryKey: listKey });
  const go = (d: string) => {
    setSelected(new Set());
    router.push(`/servers/${server.id}/files?dir=${encodeURIComponent(normalizePath(d))}` as Route);
  };
  const editHref = (path: string, isNew = false) =>
    `/servers/${server.id}/files/edit?file=${encodeURIComponent(path)}${isNew ? "&new=1" : ""}` as Route;

  const onError = (e: { message: string }) => toast.error(e.message);
  const done = (msg: string) => async () => {
    toast.success(msg);
    setModal(null);
    setSelected(new Set());
    await refresh();
  };

  const download = useMutation(trpc.servers.files.downloadUrl.mutationOptions({ onError }));
  const uploadToken = useMutation(trpc.servers.files.uploadToken.mutationOptions({ onError }));
  const copy = useMutation(trpc.servers.files.copy.mutationOptions({ onSuccess: done("Copied"), onError }));
  const decompress = useMutation(
    trpc.servers.files.decompress.mutationOptions({ onSuccess: done("Extracted"), onError }),
  );

  const startDownload = async (path: string) => {
    const { url } = await download.mutateAsync({ id: server.id, file: path });
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const open = (f: FileStat) => {
    const path = joinPath(dir, f.name);
    if (f.directory) go(path);
    else if (isEditable(f) && can(perms, "file.read-content")) router.push(editHref(path));
    else if (can(perms, "file.read-content")) void startDownload(path);
  };

  const upload = async (files: File[]) => {
    if (!files.length) return;
    if (!can(perms, "file.create")) {
      toast.error("You don't have permission to upload files");
      return;
    }
    let target: Awaited<ReturnType<typeof uploadToken.mutateAsync>>;
    try {
      target = await uploadToken.mutateAsync({ id: server.id });
    } catch {
      return;
    }
    const rows = files.map((f) => ({ key: uploadKey.current++, name: f.name, done: 0, total: f.size }));
    setUploads((u) => [...u.filter((r) => !r.finished), ...rows]);
    let ok = 0;
    for (const [i, f] of files.entries()) {
      const key = rows[i]?.key;
      const patch = (p: Partial<UploadRow>) => setUploads((u) => u.map((r) => (r.key === key ? { ...r, ...p } : r)));
      try {
        await uploadFile(target, f, joinPath(dir, f.name), (d, t) => patch({ done: d, total: t }));
        patch({ finished: true, done: f.size });
        ok++;
      } catch (e) {
        patch({ finished: true, error: e instanceof Error ? e.message : "Upload failed" });
      }
    }
    if (ok) toast.success(`Uploaded ${ok} file${ok === 1 ? "" : "s"}`);
    await refresh();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files: File[] = [];
    let folders = 0;
    for (const item of Array.from(e.dataTransfer.items)) {
      if (item.kind !== "file") continue;
      if (item.webkitGetAsEntry?.()?.isDirectory) {
        folders++;
        continue;
      }
      const f = item.getAsFile();
      if (f) files.push(f);
    }
    if (folders) toast.warning("Folders can't be uploaded directly; upload a .zip and extract it instead.");
    void upload(files);
  };

  const files = list.data?.files ?? [];
  const allSelected = files.length > 0 && files.every((f) => selected.has(f.name));
  const toggle = (name: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  const selectedNames = files.filter((f) => selected.has(f.name)).map((f) => f.name);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap items-center gap-1 font-mono text-sm" aria-label="Current folder">
          {breadcrumbs(dir).map((c, i, all) => (
            <span key={c.path} className="flex items-center gap-1">
              {i > 1 ? <span className="text-muted-foreground">/</span> : null}
              {i === all.length - 1 ? (
                <span className="font-semibold">{c.name === "/" ? "/home/container" : c.name}</span>
              ) : (
                <button type="button" className="underline-offset-2 hover:underline" onClick={() => go(c.path)}>
                  {c.name === "/" ? "/home/container" : c.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        <div className="flex flex-wrap gap-2">
          {selectedNames.length ? (
            <>
              {can(perms, "file.update") ? (
                <Button variant="outline" size="sm" onClick={() => setModal({ kind: "move", names: selectedNames })}>
                  Move
                </Button>
              ) : null}
              {can(perms, "file.archive") ? (
                <Button variant="outline" size="sm" onClick={() => setModal({ kind: "archive", names: selectedNames })}>
                  Archive
                </Button>
              ) : null}
              {can(perms, "file.delete") ? (
                <Button variant="destructive" size="sm" onClick={() => setModal({ kind: "delete", names: selectedNames })}>
                  Delete {selectedNames.length}
                </Button>
              ) : null}
            </>
          ) : null}
          {can(perms, "file.create") ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setModal({ kind: "newfile" })}>
                <FilePlus /> New file
              </Button>
              <Button variant="outline" size="sm" onClick={() => setModal({ kind: "mkdir" })}>
                <FolderPlus /> New folder
              </Button>
              <Button variant="outline" size="sm" onClick={() => setModal({ kind: "pull" })}>
                <Link2 /> From URL
              </Button>
              <Button size="sm" onClick={() => fileInput.current?.click()}>
                <Upload /> Upload
              </Button>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="sr-only"
                aria-label="Upload files"
                onChange={(e) => {
                  void upload(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </>
          ) : null}
        </div>
      </div>

      {uploads.length ? (
        <div className="grid gap-1 p-2 ring-1 ring-foreground/10">
          {uploads.map((u) => (
            <div key={u.key} className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs">
              <div>
                <div className="flex justify-between gap-2">
                  <span className="truncate font-mono">{u.name}</span>
                  <span className={cn("text-muted-foreground", u.error && "text-destructive")}>
                    {u.error ?? (u.finished ? "done" : `${formatBytes(u.done)} / ${formatBytes(u.total)}`)}
                  </span>
                </div>
                <div className="mt-1 h-1 bg-muted">
                  <div
                    className={cn("h-1 transition-all", u.error ? "bg-destructive" : "bg-primary")}
                    style={{ width: `${u.total ? Math.round((u.done / u.total) * 100) : u.finished ? 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
          {uploads.every((u) => u.finished) ? (
            <div>
              <Button variant="ghost" size="xs" onClick={() => setUploads([])}>
                Clear
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <section
        aria-label="Files"
        onDragOver={(e) => {
          if (!can(perms, "file.create") || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn("relative ring-1 ring-foreground/10", dragging && "ring-2 ring-primary")}
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-background/80 font-medium">
            Drop files to upload to {dir}
          </div>
        ) : null}
        {list.isPending ? (
          <Skeleton className="h-64" />
        ) : list.isError ? (
          <p className="p-4 text-destructive text-sm">{list.error.message}</p>
        ) : (
          <table className="w-full text-left text-xs [&_tbody_tr]:border-t [&_td]:px-3 [&_td]:py-1.5 [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium [&_th]:text-muted-foreground">
            <thead>
              <tr>
                <th className="w-8">
                  <Checkbox
                    aria-label="Select all"
                    checked={allSelected}
                    onCheckedChange={(c) => setSelected(c === true ? new Set(files.map((f) => f.name)) : new Set())}
                  />
                </th>
                <th>Name</th>
                <th className="w-24 text-right">Size</th>
                <th className="hidden w-44 md:table-cell">Modified</th>
                <th className="hidden w-24 md:table-cell">Mode</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {dir !== "/" ? (
                <tr className="hover:bg-muted/50">
                  <td />
                  <td colSpan={5}>
                    <button type="button" className="flex items-center gap-2" onClick={() => go(parentDir(dir))}>
                      <Folder className="size-4 text-muted-foreground" /> ..
                    </button>
                  </td>
                </tr>
              ) : null}
              {files.map((f) => {
                const path = joinPath(dir, f.name);
                const Icon = f.directory ? Folder : isArchive(f.name) ? FileArchive : isEditable(f) ? FileCode : FileIcon;
                return (
                  <tr key={f.name} className={cn("hover:bg-muted/50", selected.has(f.name) && "bg-muted/60")}>
                    <td>
                      <Checkbox
                        aria-label={`Select ${f.name}`}
                        checked={selected.has(f.name)}
                        onCheckedChange={() => toggle(f.name)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="flex max-w-full items-center gap-2 text-left"
                        onClick={() => open(f)}
                        title={f.directory ? "Open folder" : isEditable(f) ? "Edit" : "Download"}
                      >
                        <Icon className={cn("size-4 shrink-0", f.directory ? "text-sky-500" : "text-muted-foreground")} />
                        <span className="truncate">{f.name}</span>
                        {f.symlink ? <span className="text-muted-foreground">(link)</span> : null}
                      </button>
                    </td>
                    <td className="text-right font-mono">{f.directory ? "–" : formatBytes(f.size)}</td>
                    <td className="hidden text-muted-foreground md:table-cell">{formatDate(f.modified)}</td>
                    <td className="hidden font-mono text-muted-foreground md:table-cell" title={f.mode}>
                      {f.mode_bits}
                    </td>
                    <td className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-xs" aria-label={`Actions for ${f.name}`} />}
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-card">
                          {f.file && isEditable(f) && can(perms, "file.read-content") ? (
                            <DropdownMenuItem onClick={() => router.push(editHref(path))}>Edit</DropdownMenuItem>
                          ) : null}
                          {f.file && can(perms, "file.read-content") ? (
                            <DropdownMenuItem onClick={() => void startDownload(path)}>
                              <Download /> Download
                            </DropdownMenuItem>
                          ) : null}
                          {can(perms, "file.update") ? (
                            <>
                              <DropdownMenuItem onClick={() => setModal({ kind: "rename", file: f })}>Rename</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setModal({ kind: "move", names: [f.name] })}>Move</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setModal({ kind: "chmod", file: f })}>Permissions</DropdownMenuItem>
                            </>
                          ) : null}
                          {f.file && can(perms, "file.create") ? (
                            <DropdownMenuItem onClick={() => copy.mutate({ id: server.id, location: path })}>
                              Copy
                            </DropdownMenuItem>
                          ) : null}
                          {can(perms, "file.archive") ? (
                            isArchive(f.name) && f.file ? (
                              <DropdownMenuItem
                                onClick={() => decompress.mutate({ id: server.id, root: dir, file: f.name })}
                              >
                                Extract here
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => setModal({ kind: "archive", names: [f.name] })}>
                                Archive
                              </DropdownMenuItem>
                            )
                          ) : null}
                          {can(perms, "file.delete") ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setModal({ kind: "delete", names: [f.name] })}
                              >
                                Delete
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
              {files.length === 0 ? (
                <tr>
                  <td />
                  <td colSpan={5} className="py-6 text-muted-foreground">
                    This folder is empty.{can(perms, "file.create") ? " Drop files here to upload." : ""}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </section>

      <FileDialogs
        modal={modal}
        close={() => setModal(null)}
        serverId={server.id}
        dir={dir}
        onDone={done}
        onError={onError}
        openNewFile={(name) => {
          setModal(null);
          router.push(editHref(joinPath(dir, name), true));
        }}
        afterPull={async () => {
          setModal(null);
          toast.success("The node is downloading the file. It appears here when done.");
          setTimeout(() => void refresh(), 3000);
        }}
      />
    </div>
  );
}

function FileDialogs({
  modal,
  close,
  serverId,
  dir,
  onDone,
  onError,
  openNewFile,
  afterPull,
}: {
  modal: Modal | null;
  close: () => void;
  serverId: string;
  dir: string;
  onDone: (msg: string) => () => Promise<void>;
  onError: (e: { message: string }) => void;
  openNewFile: (name: string) => void;
  afterPull: () => Promise<void>;
}) {
  return (
    <Dialog open={modal !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        {modal?.kind === "mkdir" ? (
          <MkdirDialog serverId={serverId} dir={dir} onDone={onDone} onError={onError} close={close} />
        ) : modal?.kind === "newfile" ? (
          <NameDialog
            title="New file"
            description={`Created in ${dir} when you first save it.`}
            initial=""
            submit="Create"
            onSubmit={openNewFile}
            close={close}
          />
        ) : modal?.kind === "rename" ? (
          <RenameDialog serverId={serverId} dir={dir} file={modal.file} onDone={onDone} onError={onError} close={close} />
        ) : modal?.kind === "move" ? (
          <MoveDialog serverId={serverId} dir={dir} names={modal.names} onDone={onDone} onError={onError} close={close} />
        ) : modal?.kind === "chmod" ? (
          <ChmodDialog serverId={serverId} dir={dir} file={modal.file} onDone={onDone} onError={onError} close={close} />
        ) : modal?.kind === "delete" ? (
          <DeleteDialog serverId={serverId} dir={dir} names={modal.names} onDone={onDone} onError={onError} close={close} />
        ) : modal?.kind === "archive" ? (
          <ArchiveDialog serverId={serverId} dir={dir} names={modal.names} onDone={onDone} onError={onError} close={close} />
        ) : modal?.kind === "pull" ? (
          <PullDialog serverId={serverId} dir={dir} onError={onError} close={close} afterPull={afterPull} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type DialogProps = {
  serverId: string;
  dir: string;
  onDone: (msg: string) => () => Promise<void>;
  onError: (e: { message: string }) => void;
  close: () => void;
};

function NameDialog({
  title,
  description,
  initial,
  submit,
  pending,
  onSubmit,
  close,
  validate = (v) => (isValidName(v) ? null : "Use a plain name without slashes"),
  label = "Name",
}: {
  title: string;
  description?: string;
  initial: string;
  submit: string;
  pending?: boolean;
  onSubmit: (value: string) => void;
  close: () => void;
  validate?: (v: string) => string | null;
  label?: string;
}) {
  const [value, setValue] = useState(initial);
  const error = value ? validate(value.trim()) : null;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim() || error) return;
        onSubmit(value.trim());
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      <div className="grid gap-1.5">
        <Input autoFocus aria-label={label} value={value} onChange={(e) => setValue(e.target.value)} />
        {error ? <p className="text-destructive">{error}</p> : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={!value.trim() || !!error || pending}>
          {submit}
        </Button>
      </DialogFooter>
    </form>
  );
}

function MkdirDialog({ serverId, dir, onDone, onError, close }: DialogProps) {
  const m = useMutation(trpc.servers.files.createDirectory.mutationOptions({ onSuccess: onDone("Folder created"), onError }));
  return (
    <NameDialog
      title="New folder"
      description={`In ${dir}`}
      initial=""
      submit="Create"
      pending={m.isPending}
      onSubmit={(name) => m.mutate({ id: serverId, directory: dir, name })}
      close={close}
    />
  );
}

function RenameDialog({ serverId, dir, file, onDone, onError, close }: DialogProps & { file: FileStat }) {
  const m = useMutation(trpc.servers.files.rename.mutationOptions({ onSuccess: onDone("Renamed"), onError }));
  return (
    <NameDialog
      title={`Rename ${file.name}`}
      initial={file.name}
      submit="Rename"
      pending={m.isPending}
      onSubmit={(to) => (to === file.name ? close() : m.mutate({ id: serverId, root: dir, files: [{ from: file.name, to }] }))}
      close={close}
    />
  );
}

function MoveDialog({ serverId, dir, names, onDone, onError, close }: DialogProps & { names: string[] }) {
  const m = useMutation(trpc.servers.files.rename.mutationOptions({ onSuccess: onDone("Moved"), onError }));
  return (
    <NameDialog
      title={names.length === 1 ? `Move ${names[0]}` : `Move ${names.length} items`}
      description="Destination folder, from the server root (e.g. /plugins/old). It must exist."
      label="Destination folder"
      initial={dir}
      submit="Move"
      pending={m.isPending}
      validate={(v) => (v.startsWith("/") ? null : "Start with / (the server root)")}
      onSubmit={(target) => {
        const to = normalizePath(target);
        if (to === dir) return close();
        m.mutate({
          id: serverId,
          root: "/",
          files: names.map((n) => ({ from: joinPath(dir, n), to: joinPath(to, n) })),
        });
      }}
      close={close}
    />
  );
}

function ChmodDialog({ serverId, dir, file, onDone, onError, close }: DialogProps & { file: FileStat }) {
  const m = useMutation(trpc.servers.files.chmod.mutationOptions({ onSuccess: onDone("Permissions updated"), onError }));
  return (
    <NameDialog
      title={`Permissions of ${file.name}`}
      description={`Currently ${file.mode} (${file.mode_bits}). Octal, e.g. 644 for files, 755 for folders/scripts.`}
      label="Mode"
      initial={file.mode_bits}
      submit="Save"
      pending={m.isPending}
      validate={(v) => (isValidMode(v) ? null : "3 or 4 octal digits, e.g. 644")}
      onSubmit={(mode) => m.mutate({ id: serverId, root: dir, files: [{ file: file.name, mode }] })}
      close={close}
    />
  );
}

function DeleteDialog({ serverId, dir, names, onDone, onError, close }: DialogProps & { names: string[] }) {
  const m = useMutation(trpc.servers.files.delete.mutationOptions({ onSuccess: onDone("Deleted"), onError }));
  return (
    <>
      <DialogHeader>
        <DialogTitle>{names.length === 1 ? `Delete ${names[0]}?` : `Delete ${names.length} items?`}</DialogTitle>
        <DialogDescription>Folders are deleted with everything in them. This can't be undone.</DialogDescription>
      </DialogHeader>
      {names.length > 1 ? (
        <ul className="max-h-40 list-inside list-disc overflow-y-auto font-mono">
          {names.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button variant="destructive" disabled={m.isPending} onClick={() => m.mutate({ id: serverId, root: dir, files: names })}>
          {m.isPending ? "Deleting…" : "Delete"}
        </Button>
      </DialogFooter>
    </>
  );
}

function ArchiveDialog({ serverId, dir, names, onDone, onError, close }: DialogProps & { names: string[] }) {
  const [format, setFormat] = useState<"tar.gz" | "zip">("tar.gz");
  const m = useMutation(
    trpc.servers.files.compress.mutationOptions({
      onSuccess: (stat) => onDone(`Created ${stat.name}`)(),
      onError,
    }),
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>{names.length === 1 ? `Archive ${names[0]}` : `Archive ${names.length} items`}</DialogTitle>
        <DialogDescription>Creates archive-&lt;time&gt; in {dir}.</DialogDescription>
      </DialogHeader>
      <div className="flex gap-4">
        {(["tar.gz", "zip"] as const).map((f) => (
          <label key={f} className="flex items-center gap-1.5">
            <input type="radio" name="archive-format" checked={format === f} onChange={() => setFormat(f)} />.{f}
          </label>
        ))}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button disabled={m.isPending} onClick={() => m.mutate({ id: serverId, root: dir, files: names, format })}>
          {m.isPending ? "Archiving…" : "Archive"}
        </Button>
      </DialogFooter>
    </>
  );
}

function PullDialog({
  serverId,
  dir,
  onError,
  close,
  afterPull,
}: Omit<DialogProps, "onDone"> & { afterPull: () => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [filename, setFilename] = useState("");
  const m = useMutation(trpc.servers.files.pull.mutationOptions({ onSuccess: () => void afterPull(), onError }));
  const validUrl = /^https?:\/\/\S+$/.test(url.trim());
  const badName = filename.trim() !== "" && !isValidName(filename.trim());
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!validUrl || badName) return;
        m.mutate({ id: serverId, url: url.trim(), directory: dir, ...(filename.trim() ? { filename: filename.trim() } : {}) });
      }}
    >
      <DialogHeader>
        <DialogTitle>Download from URL</DialogTitle>
        <DialogDescription>The node downloads the file into {dir}. Only public http(s) addresses are allowed.</DialogDescription>
      </DialogHeader>
      <Input autoFocus aria-label="URL" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
      <Input
        aria-label="File name"
        placeholder="File name (optional, taken from the server otherwise)"
        value={filename}
        onChange={(e) => setFilename(e.target.value)}
      />
      {badName ? <p className="text-destructive">Use a plain file name without slashes</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={!validUrl || badName || m.isPending}>
          {m.isPending ? "Starting…" : "Download"}
        </Button>
      </DialogFooter>
    </form>
  );
}
