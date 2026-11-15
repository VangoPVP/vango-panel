export const SSH_KEY_TYPES = [
  "ssh-ed25519",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "ssh-rsa",
] as const;
export type SshKeyType = (typeof SSH_KEY_TYPES)[number];

export const RSA_MIN_BITS = 2048;

export type ParsedSshKey = {
  type: SshKeyType;
  blob: Uint8Array;
  normalized: string;
  comment: string;
  bits: number;
};

export type SshKeyResult = { ok: true; key: ParsedSshKey } | { ok: false; error: string };

function b64decode(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

class Reader {
  private pos = 0;
  constructor(private readonly buf: Uint8Array) {}
  string(): Uint8Array | null {
    if (this.pos + 4 > this.buf.length) return null;
    const b = this.buf;
    const len = ((b[this.pos] ?? 0) << 24) | ((b[this.pos + 1] ?? 0) << 16) | ((b[this.pos + 2] ?? 0) << 8) | (b[this.pos + 3] ?? 0);
    this.pos += 4;
    if (len < 0 || this.pos + len > b.length) return null;
    const out = b.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  get done() {
    return this.pos === this.buf.length;
  }
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

function mpintBits(b: Uint8Array): number {
  let i = 0;
  while (i < b.length && b[i] === 0) i++;
  if (i === b.length) return 0;
  return (b.length - i - 1) * 8 + (32 - Math.clz32(b[i] ?? 0));
}

const CURVE_BITS: Record<string, number> = { nistp256: 256, nistp384: 384, nistp521: 521 };

export function parseSshPublicKey(input: string): SshKeyResult {
  const line = input.trim().replace(/\s+/g, " ");
  if (!line) return { ok: false, error: "Paste a public key" };
  if (/PRIVATE KEY/.test(line)) return { ok: false, error: "That's a PRIVATE key. Paste the .pub file instead, and keep the private key secret." };
  const [type, data, ...rest] = line.split(" ");
  if (!type || !data) return { ok: false, error: "Expected \"<type> <base64> [comment]\" (the contents of a .pub file)" };
  if (!(SSH_KEY_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `Unsupported key type "${type}". Use ed25519 (recommended), ECDSA or RSA.` };
  }
  const blob = b64decode(data);
  if (!blob) return { ok: false, error: "The key data isn't valid base64" };

  const r = new Reader(blob);
  const inner = r.string();
  if (!inner || text(inner) !== type) return { ok: false, error: "The key data doesn't match its type" };

  let bits = 0;
  if (type === "ssh-ed25519") {
    const pk = r.string();
    if (!pk || pk.length !== 32) return { ok: false, error: "Malformed ed25519 key" };
    bits = 256;
  } else if (type === "ssh-rsa") {
    const e = r.string();
    const n = r.string();
    if (!e || !n) return { ok: false, error: "Malformed RSA key" };
    bits = mpintBits(n);
    if (bits < RSA_MIN_BITS) return { ok: false, error: `RSA keys must be at least ${RSA_MIN_BITS} bits (this one is ${bits})` };
  } else {
    const curve = r.string();
    const point = r.string();
    const expected = type.slice("ecdsa-sha2-".length);
    if (!curve || !point || text(curve) !== expected) return { ok: false, error: "Malformed ECDSA key" };
    bits = CURVE_BITS[expected] ?? 0;
  }
  if (!r.done) return { ok: false, error: "Unexpected trailing data in the key" };

  return {
    ok: true,
    key: { type: type as SshKeyType, blob, normalized: `${type} ${data}`, comment: rest.join(" "), bits },
  };
}

export async function sshFingerprint(blob: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", blob.slice()));
  let bin = "";
  for (const byte of digest) bin += String.fromCharCode(byte);
  return `SHA256:${btoa(bin).replace(/=+$/, "")}`;
}

export function parseSftpUsername(login: string): { username: string; serverPrefix: string } | null {
  const i = login.lastIndexOf(".");
  if (i <= 0) return null;
  const username = login.slice(0, i).toLowerCase();
  const serverPrefix = login.slice(i + 1).toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(serverPrefix)) return null;
  return { username, serverPrefix };
}
