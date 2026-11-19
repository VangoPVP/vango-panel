import { expect, test } from "bun:test";

import { randomToken } from "./crypto";
import { bearerCredential, hashPhpMyAdminToken, PHPMYADMIN_TOKEN_RE, phpMyAdminSignonUrl } from "./phpmyadmin";

test("generated tokens match the redeem format", () => {
  for (let i = 0; i < 50; i++) expect(PHPMYADMIN_TOKEN_RE.test(randomToken(32))).toBe(true);
  for (const bad of ["", "short", `${"a".repeat(42)}=`, `${"a".repeat(43)}x`, `${"a".repeat(42)}/`]) {
    expect(PHPMYADMIN_TOKEN_RE.test(bad)).toBe(false);
  }
});

test("token hashes are stable sha256 hex and differ per token", () => {
  const t = randomToken(32);
  expect(hashPhpMyAdminToken(t)).toMatch(/^[0-9a-f]{64}$/);
  expect(hashPhpMyAdminToken(t)).toBe(hashPhpMyAdminToken(t));
  expect(hashPhpMyAdminToken(t)).not.toBe(hashPhpMyAdminToken(randomToken(32)));
  expect(hashPhpMyAdminToken(t)).not.toContain(t);
});

test("signon URL points at the script under the configured base", () => {
  expect(phpMyAdminSignonUrl("http://192.168.2.108:8081", "abc")).toBe(
    "http://192.168.2.108:8081/vango-signon.php?token=abc",
  );
  expect(phpMyAdminSignonUrl("https://pma.example.com/", "abc")).toBe("https://pma.example.com/vango-signon.php?token=abc");
  expect(phpMyAdminSignonUrl("https://example.com/pma?x=1#y", "a-b_c")).toBe(
    "https://example.com/pma/vango-signon.php?token=a-b_c",
  );
});

test("bearer credentials are parsed strictly", () => {
  expect(bearerCredential("Bearer s3cret")).toBe("s3cret");
  expect(bearerCredential("bearer s3cret")).toBe("s3cret");
  for (const bad of [null, undefined, "", "Bearer", "Bearer ", "Basic s3cret", "Bearer a b", "s3cret"]) {
    expect(bearerCredential(bad)).toBeNull();
  }
});
