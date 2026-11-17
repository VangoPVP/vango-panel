import { useForm } from "@tanstack/react-form";
import { Button } from "@vango-panel/ui/components/button";
import { Checkbox } from "@vango-panel/ui/components/checkbox";
import { Input } from "@vango-panel/ui/components/input";
import { Label } from "@vango-panel/ui/components/label";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";

// Rendered only by /login, which already redirects signed-in users on the server,
// so there's no need to wait for a client-side session check before showing the form.
export default function SignInForm({ onSwitchToSignUp }: { onSwitchToSignUp: () => void }) {
  const router = useRouter();
  const [needsCode, setNeedsCode] = useState(false);
  // "/" sends people to the dashboard, or to 2FA setup if policy requires it and it's not on yet.
  const done = () => {
    toast.success("Signed in");
    router.replace("/");
    router.refresh();
  };

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      const login = value.email.trim();
      const handlers = {
        onSuccess: (ctx: { data: unknown }) => {
          // Correct password, but this account has 2FA: no session yet, ask for the code.
          if ((ctx.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) setNeedsCode(true);
          else done();
        },
        onError: (error: { error: { message?: string; statusText: string } }) => {
          toast.error(error.error.message || error.error.statusText);
        },
      };
      if (login.includes("@")) {
        await authClient.signIn.email({ email: login, password: value.password }, handlers);
      } else {
        await authClient.signIn.username({ username: login, password: value.password }, handlers);
      }
    },
    validators: {
      onSubmit: z.object({
        email: z.string().trim().min(1, "Enter your email or username"),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }),
    },
  });

  if (needsCode) return <TwoFactorStep onDone={done} onBack={() => setNeedsCode(false)} />;

  return (
    <div className="mx-auto w-full mt-10 max-w-md p-6">
      <h1 className="mb-6 text-center text-3xl font-bold">Welcome Back</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="space-y-4"
      >
        <div>
          <form.Field name="email">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Email or username</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="text"
                  autoComplete="username"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-red-500">
                    {error?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>
        </div>

        <div>
          <form.Field name="password">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Password</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="password"
                  autoComplete="current-password"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-red-500">
                    {error?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>
        </div>

        <form.Subscribe
          selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}
        >
          {({ canSubmit, isSubmitting }) => (
            <Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "Submitting..." : "Sign In"}
            </Button>
          )}
        </form.Subscribe>
      </form>

      <div className="mt-4 text-center">
        <Button
          variant="link"
          onClick={onSwitchToSignUp}
          className="text-indigo-600 hover:text-indigo-800"
        >
          Need an account? Sign Up
        </Button>
      </div>
    </div>
  );
}

function TwoFactorStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [backup, setBackup] = useState(false);
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    const body = { code: backup ? code.trim() : code.replace(/\s/g, ""), trustDevice };
    const { error: err } = backup
      ? await authClient.twoFactor.verifyBackupCode(body)
      : await authClient.twoFactor.verifyTotp(body);
    setPending(false);
    if (!err) return onDone();
    if (err.status === 429) setError("Too many attempts. Wait a few seconds and try again.");
    else if (/cookie|expired/i.test(err.message ?? "")) setError("This sign-in expired. Go back and enter your password again.");
    else setError(backup ? "That backup code isn't valid (each one works once)." : "That code isn't valid. Check your authenticator app.");
  };

  return (
    <div className="mx-auto mt-10 w-full max-w-md p-6">
      <h1 className="mb-2 text-center font-bold text-3xl">Two-factor authentication</h1>
      <p className="mb-6 text-center text-muted-foreground text-sm">
        {backup ? "Enter one of your backup codes." : "Enter the 6-digit code from your authenticator app."}
      </p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="otp">{backup ? "Backup code" : "Authentication code"}</Label>
          <Input
            id="otp"
            key={backup ? "backup" : "totp"}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            inputMode={backup ? "text" : "numeric"}
            maxLength={backup ? 32 : 7}
            placeholder={backup ? "xxxxx-xxxxx" : "123456"}
            className="font-mono tracking-widest"
            aria-invalid={error ? true : undefined}
            autoFocus
          />
          {error ? <p className="text-red-500 text-sm">{error}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="trust" checked={trustDevice} onCheckedChange={(v) => setTrustDevice(v === true)} />
          <Label htmlFor="trust" className="font-normal">
            Trust this device for 30 days
          </Label>
        </div>
        <Button type="submit" className="w-full" disabled={pending || !code.trim()}>
          {pending ? "Verifying…" : "Verify"}
        </Button>
      </form>
      <div className="mt-4 flex justify-between">
        <Button variant="link" className="px-0" onClick={onBack}>
          Back
        </Button>
        <Button
          variant="link"
          className="px-0"
          onClick={() => {
            setBackup((b) => !b);
            setCode("");
            setError(null);
          }}
        >
          {backup ? "Use authenticator app" : "Use a backup code instead"}
        </Button>
      </div>
    </div>
  );
}
