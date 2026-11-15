import { expect, test } from "bun:test";

import { parseSftpUsername, parseSshPublicKey, sshFingerprint } from "./ssh";

const KEYS = {
  "ed25519": {
    "pub": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIH1QtqZxgiMXshv3WU7sbsuFqaYN0U96VFhFPzmzQqtm alice@laptop",
    "bits": 256,
    "fp": "SHA256:1fV8qVQ00TY/yzMpAh/BD5ihlgBLUFMaoK3y2WNbsSQ"
  },
  "ecdsa384": {
    "pub": "ecdsa-sha2-nistp384 AAAAE2VjZHNhLXNoYTItbmlzdHAzODQAAAAIbmlzdHAzODQAAABhBOQY4DA4Z1BTjjO3xU0t94fL6QZqbVAxmXHOAb7AR52EVVD3gnXkGbSedv5NDlD/YZ6GX+gFIGZO6riOnFiMR0X6StOVQM7BEtxJleB1It2E0+4VYMhjJ2uHCXXEFr49PA==",
    "bits": 384,
    "fp": "SHA256:nPnGIFu3GVFsO0Sc2+PTcqfkoDyYAujJklqtawWchLY"
  },
  "rsa3072": {
    "pub": "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDiTmZndFz87095GhPJkDe/MPvN6AbxnLvea5sj0SQ0mdwY4jXMMSJ6qTzxz9zq/hAf5+8P3SLnZXnRf9k9R4IX1yVIw/DHZuamLJx+d5RRh9rRf/q9Gyp9msl48THPwXbSkF5Uy8qO2EijgFXRYGf1Y9uQGYcmEXw2Dyqu5tbQq1j5iky41QSCU9XkChleSab5h8esEdks1fckieJxIx3z4gT2Caez88W0lUsENOUoaA16P5X2ejI1hMXhwRdPOuoD/wUy/vmtSYHxdK8DtJ+D0JU17ISGSSuie/7I1UtA0lPKUnooJYzPDg1/eoOgQrI4s00TS9gZ0qZy1CtMXwXAwBjajnsyCi40k3nTcq8ATYa9GlftAT7uo2okUnpmaNFIa+B14eYy7vciGSizIbBpl396i+RMf63lDEAn1BiXZCJdKuPOIgr5xrafVV/uvvxO9Ig0r7Qe744VlQq/tuv3I4jD/NgHZeASP2b4ywO4GTUJ8lmtukAMzhQzBO1VXNU= rsa3072",
    "bits": 3072,
    "fp": "SHA256:WAaCpeTjjHM228uvKLhuu8PfgftSisBYJ9hTa4v+xy8"
  },
  "rsa1024": {
    "pub": "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAAgQDHkFDtj+edrXePxy09JIfqlsLZ0yepBEVCXgo9+7AReNPiNtM1jorzc++EJeT33of9lJh1NIr+tDY0edmZMbQqoVBuqNbAS9fVkEhKpKFJqKjE+QNl1Mj8T69j8TEen/qLeTsJaDue4gImDk9dERVj1eaqgKCZtYYB5qfoPfDrZw== weak",
    "bits": 1024,
    "fp": "SHA256:WBH3C9W0gkp1tR0MDvwrF9BWcNa5jdh++ZrALqhiJZY"
  }
} as const;

test("parses real keys and matches ssh-keygen fingerprints", async () => {
  for (const name of ["ed25519", "ecdsa384", "rsa3072"] as const) {
    const k = KEYS[name];
    const r = parseSshPublicKey(k.pub);
    if (!r.ok) throw new Error(`${name}: ${r.error}`);
    expect(r.key.bits).toBe(k.bits);
    expect(await sshFingerprint(r.key.blob)).toBe(k.fp);
  }
  const ed = parseSshPublicKey(`  ${KEYS.ed25519.pub}\n`);
  expect(ed.ok && ed.key.comment).toBe("alice@laptop");
  expect(ed.ok && ed.key.normalized).toBe(KEYS.ed25519.pub.split(" ").slice(0, 2).join(" "));
});

test("rejects weak, malformed and private keys", () => {
  const weak = parseSshPublicKey(KEYS.rsa1024.pub);
  expect(weak.ok ? null : weak.error).toBe("RSA keys must be at least 2048 bits (this one is 1024)");
  const [type, data] = KEYS.ed25519.pub.split(" ") as [string, string];
  expect(parseSshPublicKey(`ssh-rsa ${data}`).ok).toBe(false);
  expect(parseSshPublicKey(`${type} ${data.slice(0, -8)}`).ok).toBe(false);
  expect(parseSshPublicKey(`${type} not*base64`).ok).toBe(false);
  expect(parseSshPublicKey("ssh-dss AAAAB3NzaC1kc3M=").ok).toBe(false);
  expect(parseSshPublicKey("").ok).toBe(false);
  const priv = parseSshPublicKey("-----BEGIN OPENSSH PRIVATE KEY----- b3BlbnNzaC1rZXktdjE=");
  expect(priv.ok ? null : priv.error).toContain("PRIVATE key");
});

test("parseSftpUsername splits at the last dot", () => {
  expect(parseSftpUsername("toby.54c28246")).toEqual({ username: "toby", serverPrefix: "54c28246" });
  expect(parseSftpUsername("Toby.J.54C28246")).toEqual({ username: "toby.j", serverPrefix: "54c28246" });
  expect(parseSftpUsername("toby")).toBeNull();
  expect(parseSftpUsername(".54c28246")).toBeNull();
  expect(parseSftpUsername("toby.54c2824")).toBeNull();
  expect(parseSftpUsername("toby.zzzzzzzz")).toBeNull();
});
