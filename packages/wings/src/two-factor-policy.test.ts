import { expect, test } from "bun:test";

import { needsTwoFactorSetup, twoFactorRequiredFor } from "@vango-panel/auth/two-factor";

test("policy decides who must use 2FA", () => {
  for (const role of ["superadmin", "admin"]) {
    expect(twoFactorRequiredFor({ role }, "admins")).toBe(true);
    expect(twoFactorRequiredFor({ role }, "none")).toBe(false);
  }
  expect(twoFactorRequiredFor({ role: "user" }, "admins")).toBe(false);
  expect(twoFactorRequiredFor({ role: "user" }, "all")).toBe(true);
  expect(twoFactorRequiredFor({ role: null }, "admins")).toBe(false);
});

test("setup is only demanded until 2FA is on", () => {
  expect(needsTwoFactorSetup({ role: "admin", twoFactorEnabled: false }, "admins")).toBe(true);
  expect(needsTwoFactorSetup({ role: "admin", twoFactorEnabled: null }, "admins")).toBe(true);
  expect(needsTwoFactorSetup({ role: "admin", twoFactorEnabled: true }, "admins")).toBe(false);
  expect(needsTwoFactorSetup({ role: "user", twoFactorEnabled: false }, "admins")).toBe(false);
});
