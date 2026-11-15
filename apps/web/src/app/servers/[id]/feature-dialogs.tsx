"use client";
import { useMutation } from "@tanstack/react-query";
import { isAdminRole } from "@vango-panel/auth/roles";
import { Button } from "@vango-panel/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vango-panel/ui/components/dialog";
import { Input } from "@vango-panel/ui/components/input";
import {
  type EggFeature,
  guessJavaImage,
  javaVersionOf,
  matchFeature,
  parseJavaRequirement,
  pickJavaImage,
} from "@vango-panel/wings/features";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Select } from "@/components/form";
import type { ConsoleLine } from "@/hooks/use-server-socket";
import { authClient } from "@/lib/auth-client";
import { type RouterOutputs, trpc } from "@/utils/trpc";

type Server = RouterOutputs["servers"]["get"];

function can(perms: string[], p: string) {
  return perms.includes("*") || perms.includes(p);
}

const ONLY_WHEN_STOPPED: readonly EggFeature[] = ["eula", "java_version"];

export function FeatureDialogs({
  server,
  lines,
  state,
}: {
  server: Server;
  lines: ConsoleLine[];
  state: string | null;
}) {
  const [open, setOpen] = useState<EggFeature | null>(null);
  const handled = useRef(new Set<EggFeature>());
  const lastSeen = useRef(-1);

  useEffect(() => {
    if (!server.features.length || open) return;
    for (const line of lines) {
      if (line.id <= lastSeen.current) continue;
      lastSeen.current = line.id;
      if (line.kind !== "output") continue;
      const f = matchFeature(line.text, server.features);
      if (!f || handled.current.has(f)) continue;
      if (ONLY_WHEN_STOPPED.includes(f) && state === "running") continue;
      setOpen(f);
      return;
    }
  }, [lines, server.features, state, open]);

  const close = () => {
    if (open) handled.current.add(open);
    setOpen(null);
  };

  return (
    <Dialog open={open !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        {open === "eula" ? <EulaHelper server={server} onDone={close} /> : null}
        {open === "java_version" ? (
          <JavaHelper
            server={server}
            state={state}
            output={lines
              .filter((l) => l.kind === "output")
              .map((l) => l.text)
              .slice(-300)}
            onDone={close}
          />
        ) : null}
        {open === "pid_limit" ? <PidLimitHelper onDone={close} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EulaHelper({ server, onDone }: { server: Server; onDone: () => void }) {
  const accept = useMutation(
    trpc.servers.acceptEula.mutationOptions({
      onSuccess: (r) => {
        toast.success(r.started ? "EULA accepted, starting the server" : "EULA accepted");
        onDone();
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const allowed = can(server.permissions, "file.update");
  return (
    <>
      <DialogHeader>
        <DialogTitle>Accept the Minecraft EULA</DialogTitle>
        <DialogDescription>
          The server stopped because the Minecraft End User License Agreement hasn't been accepted.
        </DialogDescription>
      </DialogHeader>
      <p>
        By pressing <strong>I accept</strong> you agree to the{" "}
        <a className="underline" href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer">
          Minecraft EULA
        </a>
        . The panel sets <code>eula=true</code> in <code>eula.txt</code> and starts the server.
      </p>
      {!allowed ? <p className="text-destructive">You don't have permission to change files on this server.</p> : null}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Not now
        </Button>
        <Button disabled={!allowed || accept.isPending} onClick={() => accept.mutate({ id: server.id })}>
          {accept.isPending ? "Accepting…" : "I accept"}
        </Button>
      </DialogFooter>
    </>
  );
}

function JavaHelper({
  server,
  state,
  output,
  onDone,
}: {
  server: Server;
  state: string | null;
  output: string[];
  onDone: () => void;
}) {
  const { data: session } = authClient.useSession();
  const admin = isAdminRole(session?.user.role);
  const choices = Object.entries(server.imageChoices);
  const currentLabel = choices.find(([, img]) => img === server.image)?.[0] ?? server.image;
  const req = parseJavaRequirement(output);
  const current = javaVersionOf(currentLabel, server.image) ?? req.current;
  const best = req.required ? pickJavaImage(server.imageChoices, req.required) : null;
  const missing = req.required !== null && !best;

  const [image, setImage] = useState(
    () =>
      best?.image ??
      choices
        .map(([label, img]) => ({ img, v: javaVersionOf(label, img) }))
        .filter((c) => c.img !== server.image && c.v !== null && current !== null && c.v > current)
        .sort((a, b) => (a.v ?? 0) - (b.v ?? 0))[0]?.img ??
      choices.find(([, img]) => img !== server.image)?.[1] ??
      server.image,
  );
  const [newImage, setNewImage] = useState(() =>
    req.required ? (guessJavaImage(server.imageChoices, req.required) ?? "") : "",
  );

  const power = useMutation(trpc.servers.power.mutationOptions());
  const setImg = useMutation(trpc.servers.setDockerImage.mutationOptions());
  const addImage = useMutation(trpc.admin.templates.addImage.mutationOptions());
  const busy = setImg.isPending || power.isPending || addImage.isPending;
  const allowed = can(server.permissions, "startup.docker-image");

  const switchAndStart = async (target: string) => {
    try {
      if (missing) {
        await addImage.mutateAsync({ id: server.template.id, label: `Java ${req.required}`, image: target });
      }
      await setImg.mutateAsync({ id: server.id, image: target });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't change the image");
      return;
    }
    if (can(server.permissions, "control.start") || can(server.permissions, "control.restart")) {
      try {
        await power.mutateAsync({ id: server.id, action: state === "running" ? "restart" : "start" });
        toast.success("Image updated, starting the server");
      } catch (e) {
        toast.warning(`Image updated, but the server didn't start: ${e instanceof Error ? e.message : e}`);
      }
    } else {
      toast.success("Image updated. It applies on the next start.");
    }
    onDone();
  };

  const needs = req.required ? `Java ${req.required}` : "a different Java version";
  const has = current ? `Java ${current}` : currentLabel;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Unsupported Java version</DialogTitle>
        <DialogDescription>
          This server needs {needs}, but it runs on {has}.
        </DialogDescription>
      </DialogHeader>

      {missing ? (
        admin ? (
          <div className="grid gap-2">
            <p>
              None of the <strong>{server.template.name}</strong> template's images provide Java {req.required} (newest:{" "}
              {choices
                .map(([l, i]) => javaVersionOf(l, i))
                .filter((v): v is number => v !== null)
                .sort((a, b) => b - a)[0] ?? "unknown"}
              ). Add one to the template and switch this server to it:
            </p>
            <Input
              className="font-mono"
              value={newImage}
              onChange={(e) => setNewImage(e.target.value)}
              placeholder={`registry/image:java_${req.required}`}
            />
            <p className="text-muted-foreground">
              Check the image exists. Other servers using this template can then pick it too.
            </p>
          </div>
        ) : (
          <p>
            None of this server's images provide Java {req.required}. Ask an administrator to add a Java {req.required}{" "}
            image to the <strong>{server.template.name}</strong> template.
          </p>
        )
      ) : choices.length > 1 ? (
        <div className="grid gap-1.5">
          <Select value={image} onChange={(e) => setImage(e.target.value)} disabled={!allowed || busy}>
            {choices.map(([label, img]) => (
              <option key={label} value={img}>
                {label}
                {img === server.image ? " (current)" : ""}
                {best?.image === img ? " (recommended)" : ""}
              </option>
            ))}
          </Select>
          {image === server.image ? <p className="text-muted-foreground">That's the image it already uses.</p> : null}
        </div>
      ) : (
        <p>This server's template only offers one image. Ask an administrator to add other Java versions.</p>
      )}

      {!allowed && !missing ? (
        <p className="text-destructive">You don't have permission to change this server's image.</p>
      ) : null}

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          {missing && !admin ? "Close" : "Not now"}
        </Button>
        {missing ? (
          admin ? (
            <Button disabled={busy || !newImage.trim()} onClick={() => void switchAndStart(newImage.trim())}>
              {busy ? "Updating…" : `Add Java ${req.required} & start`}
            </Button>
          ) : null
        ) : (
          <Button
            disabled={!allowed || choices.length < 2 || image === server.image || busy}
            onClick={() => void switchAndStart(image)}
          >
            {busy ? "Updating…" : "Switch image & start"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

function PidLimitHelper({ onDone }: { onDone: () => void }) {
  const { data: session } = authClient.useSession();
  const admin = isAdminRole(session?.user.role);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Process or thread limit reached</DialogTitle>
        <DialogDescription>The server couldn't create a new process or thread.</DialogDescription>
      </DialogHeader>
      {admin ? (
        <div className="grid gap-2">
          <p>Each container may run a limited number of processes. To fix it, on this server's node either:</p>
          <ul className="list-inside list-disc">
            <li>
              raise <code>docker.container_pid_limit</code> in wings' <code>config.yml</code> (default 512, 0 =
              unlimited) and restart wings, or
            </li>
            <li>give the server more memory if it's also close to its memory limit.</li>
          </ul>
        </div>
      ) : (
        <p>The server hit a resource limit. Try restarting it; if this keeps happening, contact an administrator.</p>
      )}
      <DialogFooter>
        <Button onClick={onDone}>OK</Button>
      </DialogFooter>
    </>
  );
}
