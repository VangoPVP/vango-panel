// phpMyAdmin single sign-on helpers.
//
// Flow: the panel issues a random one-time token (only its SHA-256 is stored) and sends the browser
// to <PHPMYADMIN_URL>/vango-signon.php?token=…. That script POSTs the token to the panel's
// /api/phpmyadmin/redeem with the shared secret, gets the database credentials back, puts them in
// phpMyAdmin's signon session and redirects into the database. The password never reaches the browser.

import { createHash } from "node:crypto";

/** How long a token can be redeemed after it was issued. */
export const PHPMYADMIN_TOKEN_TTL_MS = 60_000;
export const PHPMYADMIN_SIGNON_SCRIPT = "vango-signon.php";
/** randomToken(32): 43 chars of base64url. */
export const PHPMYADMIN_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function hashPhpMyAdminToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** <base>/vango-signon.php?token=…, keeping any path prefix of `base` and dropping its query/hash. */
export function phpMyAdminSignonUrl(base: string, token: string): string {
  const url = new URL(base);
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  const out = new URL(PHPMYADMIN_SIGNON_SCRIPT, url);
  out.searchParams.set("token", token);
  return out.toString();
}

/** The credential from an `Authorization: Bearer <secret>` header, or null. */
export function bearerCredential(header: string | null | undefined): string | null {
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header ?? "");
  return m?.[1] ?? null;
}
