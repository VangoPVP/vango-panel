"use client";
import { Button } from "@vango-panel/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vango-panel/ui/components/card";
import { Checkbox } from "@vango-panel/ui/components/checkbox";
import { Input } from "@vango-panel/ui/components/input";
import { Label } from "@vango-panel/ui/components/label";
import { Copy, Download, ShieldCheck, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { encode } from "uqr";

import { Field } from "@/components/form";
import { authClient } from "@/lib/auth-client";

type Step =
  | { kind: "idle" }
  | { kind: "password"; action: "enable" | "disable" | "codes" }
  | { kind: "scan"; totpURI: string; backupCodes: string[] }
  | { kind: "codes"; backupCodes: string[]; finishEnable: boolean };

export function TwoFactorCard({
  enabled,
  required,
  mustSetUp,
  onChanged,
}: {
  enabled: boolean;
  required: boolean;
  mustSetUp: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(mustSetUp ? { kind: "password", action: "enable" } : { kind: "idle" });

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {enabled ? <ShieldCheck className="size-4 text-green-600" /> : <ShieldOff className="size-4 text-muted-foreground" />}
          Two-factor authentication {enabled ? <span className="text-green-600 text-xs">On</span> : null}
        </CardTitle>
        <CardDescription>
          Sign-in asks for a code from an authenticator app (Google Authenticator, Aegis, 1Password, Bitwarden, …)
          after your password.
          {required ? " Your role requires it." : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {step.kind === "idle" ? (
          enabled ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setStep({ kind: "password", action: "codes" })}>
                New backup codes
              </Button>
              <Button variant="outline" onClick={() => setStep({ kind: "password", action: "disable" })}>
                Turn off
              </Button>
            </div>
          ) : (
            <div>
              <Button onClick={() => setStep({ kind: "password", action: "enable" })}>Set up two-factor authentication</Button>
            </div>
          )
        ) : null}

        {step.kind === "password" ? (
          <PasswordStep
            action={step.action}
            required={required}
            cancellable={!mustSetUp}
            onCancel={() => setStep({ kind: "idle" })}
            onEnabled={(r) => setStep({ kind: "scan", ...r })}
            onCodes={(backupCodes) => setStep({ kind: "codes", backupCodes, finishEnable: false })}
            onDisabled={async () => {
              toast.success("Two-factor authentication turned off");
              setStep({ kind: "idle" });
              await onChanged();
              // If policy requires it, the server now sends this user to set it up again.
              if (required) router.refresh();
            }}
          />
        ) : null}

        {step.kind === "scan" ? (
          <ScanStep
            totpURI={step.totpURI}
            onVerified={() => setStep({ kind: "codes", backupCodes: step.backupCodes, finishEnable: true })}
            onCancel={mustSetUp ? undefined : () => setStep({ kind: "idle" })}
          />
        ) : null}

        {step.kind === "codes" ? (
          <BackupCodes
            codes={step.backupCodes}
            onDone={async () => {
              setStep({ kind: "idle" });
              if (step.finishEnable) {
                // Sessions from before 2FA was turned on shouldn't stay signed in elsewhere.
                await authClient.revokeOtherSessions().catch(() => {});
                toast.success("Two-factor authentication is on. Other devices were signed out.");
              }
              await onChanged();
              if (mustSetUp) {
                router.replace("/");
                router.refresh();
              }
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function PasswordStep({
  action,
  required,
  cancellable,
  onCancel,
  onEnabled,
  onCodes,
  onDisabled,
}: {
  action: "enable" | "disable" | "codes";
  required: boolean;
  cancellable: boolean;
  onCancel: () => void;
  onEnabled: (r: { totpURI: string; backupCodes: string[] }) => void;
  onCodes: (codes: string[]) => void;
  onDisabled: () => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    try {
      if (action === "enable") {
        const { data, error } = await authClient.twoFactor.enable({ password });
        if (error || !data) throw new Error(error?.message ?? "Couldn't start setup");
        onEnabled({ totpURI: data.totpURI, backupCodes: data.backupCodes });
      } else if (action === "codes") {
        const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
        if (error || !data) throw new Error(error?.message ?? "Couldn't create backup codes");
        onCodes(data.backupCodes);
      } else {
        const { error } = await authClient.twoFactor.disable({ password });
        if (error) throw new Error(error.message ?? "Couldn't turn it off");
        await onDisabled();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  const label = { enable: "Continue", codes: "Create new backup codes", disable: "Turn off" }[action];
  return (
    <form
      className="grid max-w-sm gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {action === "disable" && required ? (
        <p className="text-xs text-yellow-700 dark:text-yellow-400">
          Your role requires 2FA: you'll be asked to set it up again straight away (e.g. with a new phone).
        </p>
      ) : null}
      {action === "codes" ? (
        <p className="text-muted-foreground text-xs">Your current backup codes stop working.</p>
      ) : null}
      <Field label="Confirm your password">
        <Input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant={action === "disable" ? "destructive" : "default"} disabled={pending || !password}>
          {pending ? "Checking…" : label}
        </Button>
        {cancellable ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function QrCode({ text }: { text: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(text, { border: 2 });
    let d = "";
    qr.data.forEach((row, y) => {
      row.forEach((on, x) => {
        if (on) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { path: d, size: qr.size };
  }, [text]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="size-48 bg-white"
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code for your authenticator app"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}

function ScanStep({ totpURI, onVerified, onCancel }: { totpURI: string; onVerified: () => void; onCancel?: () => void }) {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const secret = useMemo(() => {
    try {
      return new URL(totpURI).searchParams.get("secret") ?? "";
    } catch {
      return "";
    }
  }, [totpURI]);

  const verify = async () => {
    setPending(true);
    const { error } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
    setPending(false);
    if (error) {
      toast.error(error.status === 429 ? "Too many attempts, wait a few seconds" : "That code isn't valid. Try the current one.");
      return;
    }
    onVerified();
  };

  return (
    <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
      <QrCode text={totpURI} />
      <form
        className="grid content-start gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void verify();
        }}
      >
        <ol className="list-decimal space-y-1 pl-4 text-xs">
          <li>Scan the QR code with your authenticator app.</li>
          <li>
            Can't scan? Enter this key manually:
            <div className="mt-1 flex items-center gap-1">
              <code className="break-all bg-muted px-1.5 py-0.5">{secret.replace(/(.{4})/g, "$1 ").trim()}</code>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label="Copy key"
                onClick={() => navigator.clipboard.writeText(secret).then(() => toast.success("Copied"))}
              >
                <Copy />
              </Button>
            </div>
          </li>
          <li>Enter the 6-digit code it shows to finish.</li>
        </ol>
        <Field label="Code from the app">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            placeholder="123456"
            className="w-40 font-mono tracking-widest"
            autoFocus
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending || code.replace(/\s/g, "").length !== 6}>
            {pending ? "Verifying…" : "Turn on"}
          </Button>
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => Promise<void> }) {
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const text = codes.join("\n");
  return (
    <div className="grid max-w-md gap-3">
      <p className="text-xs">
        <strong>Save these backup codes.</strong> Each one signs you in once if you lose your phone. They won't be shown
        again.
      </p>
      <pre className="grid grid-cols-2 gap-x-6 gap-y-1 bg-muted p-3 font-mono text-sm">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Copied"))}>
          <Copy /> Copy
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([`vango-panel backup codes\n\n${text}\n`], { type: "text/plain" }));
            a.download = "vango-panel-backup-codes.txt";
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          <Download /> Download
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="saved-codes" checked={saved} onCheckedChange={(v) => setSaved(v === true)} />
        <Label htmlFor="saved-codes" className="font-normal">
          I've saved my backup codes somewhere safe
        </Label>
      </div>
      <div>
        <Button
          disabled={!saved || pending}
          onClick={async () => {
            setPending(true);
            await onDone();
            setPending(false);
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
