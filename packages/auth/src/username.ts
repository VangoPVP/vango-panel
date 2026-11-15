export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

const PATTERN = /^[a-z0-9_](?:[a-z0-9_.]*[a-z0-9_])?$/;

export function normalizeUsername(u: string): string {
  return u.trim().toLowerCase();
}

export function usernameError(raw: string): string | null {
  const u = normalizeUsername(raw);
  if (u.length < USERNAME_MIN || u.length > USERNAME_MAX) {
    return `Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters.`;
  }
  if (!PATTERN.test(u) || u.includes("..")) {
    return "Use letters, numbers, _ and . (not at the start/end, no double dots).";
  }
  return null;
}

export function usernameFromSeed(seed: string): string {
  let u = normalizeUsername(seed.split("@")[0] ?? "")
    .normalize("NFKD")
    .replace(/[^\w.]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, USERNAME_MAX - 4);
  if (u.length < USERNAME_MIN) u = `user${u}`.slice(0, USERNAME_MAX - 4);
  return u;
}
