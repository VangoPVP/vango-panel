import { needsTwoFactorSetup, twoFactorRequiredFor } from "@vango-panel/auth/two-factor";

import { requireSession, twoFactorPolicy } from "@/lib/session";

import AccountView from "./account-view";

export default async function AccountPage() {
  // The one page users who still need to set up 2FA can open.
  const session = await requireSession({ allowPending2fa: true });
  const policy = twoFactorPolicy();
  return (
    <div className="container mx-auto max-w-4xl px-4 py-6">
      <AccountView
        twoFactor={{
          required: twoFactorRequiredFor(session.user, policy),
          mustSetUp: needsTwoFactorSetup(session.user, policy),
        }}
      />
    </div>
  );
}
