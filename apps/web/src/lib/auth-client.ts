import type { auth } from "@vango-panel/auth";
import { inferAdditionalFields, twoFactorClient, usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // The 2FA step is handled inline by the sign-in form (it checks `twoFactorRedirect`).
  plugins: [inferAdditionalFields<typeof auth>(), usernameClient(), twoFactorClient()],
});

export type Session = typeof authClient.$Infer.Session;
