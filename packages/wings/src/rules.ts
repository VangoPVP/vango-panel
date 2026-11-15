export type Rule = { name: string; args: string[]; regex?: RegExp };

export type ParsedRules = {
  rules: Rule[];
  unsupported: string[];
  invalid: string[];
};

const NO_OP = new Set(["sometimes", "present", "bail", "string", "filled"]);

const SUPPORTED = new Set([
  ...NO_OP,
  "required",
  "nullable",
  "integer",
  "numeric",
  "boolean",
  "alpha",
  "alpha_num",
  "alpha_dash",
  "url",
  "ip",
  "ipv4",
  "ipv6",
  "min",
  "max",
  "between",
  "size",
  "in",
  "not_in",
  "digits",
  "digits_between",
  "starts_with",
  "ends_with",
  "regex",
  "not_regex",
]);

function isCompletePattern(p: string): boolean {
  if (p.length < 2) return false;
  const delim = p[0] as string;
  const close = { "(": ")", "[": "]", "{": "}", "<": ">" }[delim] ?? delim;
  for (let i = p.length - 1; i > 0; i--) {
    const c = p[i] as string;
    if (/[a-zA-Z]/.test(c)) continue;
    if (c !== close) return false;
    let backslashes = 0;
    for (let j = i - 1; j > 0 && p[j] === "\\"; j--) backslashes++;
    return backslashes % 2 === 0;
  }
  return false;
}

export function phpRegex(p: string): RegExp | null {
  if (!isCompletePattern(p)) return null;
  const delim = p[0] as string;
  const close = { "(": ")", "[": "]", "{": "}", "<": ">" }[delim] ?? delim;
  const end = p.lastIndexOf(close);
  const body = p.slice(1, end);
  const phpFlags = p.slice(end + 1);
  let flags = "";
  for (const f of phpFlags) {
    if ("imsu".includes(f)) flags += f;
    else if (f === "D") continue;
    else return null;
  }
  try {
    return new RegExp(body, flags);
  } catch {
    return null;
  }
}

export function parseRules(spec: string | null | undefined): ParsedRules {
  const out: ParsedRules = { rules: [], unsupported: [], invalid: [] };
  const tokens = (spec ?? "").split("|");
  for (let i = 0; i < tokens.length; i++) {
    let token = (tokens[i] ?? "").trim();
    if (!token) continue;
    const colon = token.indexOf(":");
    const name = (colon === -1 ? token : token.slice(0, colon)).trim().toLowerCase();

    if (name === "regex" || name === "not_regex") {
      let pattern = token.slice(colon + 1);
      while (!isCompletePattern(pattern) && i + 1 < tokens.length) {
        i++;
        pattern += `|${tokens[i]}`;
      }
      token = `${name}:${pattern}`;
      const regex = phpRegex(pattern);
      if (regex) out.rules.push({ name, args: [pattern], regex });
      else out.invalid.push(token);
      continue;
    }

    if (!SUPPORTED.has(name)) {
      out.unsupported.push(name);
      continue;
    }
    const args = colon === -1 ? [] : token.slice(colon + 1).split(",").map((a) => a.trim());
    const needsArgs: Record<string, number> = {
      min: 1,
      max: 1,
      size: 1,
      digits: 1,
      between: 2,
      digits_between: 2,
      in: 1,
      not_in: 1,
      starts_with: 1,
      ends_with: 1,
    };
    const n = needsArgs[name];
    if (n && (args.length < n || (["min", "max", "size", "digits", "between", "digits_between"].includes(name) && args.some((a) => !Number.isFinite(Number(a)))))) {
      out.invalid.push(token);
      continue;
    }
    out.rules.push({ name, args });
  }
  return out;
}

const NUMERIC_RE = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isIpv6(v: string) {
  if (!v.includes(":") || !/^[0-9a-fA-F:.]+$/.test(v)) return false;
  try {
    new URL(`http://[${v}]/`);
    return true;
  } catch {
    return false;
  }
}

export function validateValue(label: string, value: string, spec: string | ParsedRules | null | undefined): string | null {
  const parsed = typeof spec === "object" && spec !== null ? spec : parseRules(spec);
  const names = new Set(parsed.rules.map((r) => r.name));
  if (value.trim() === "") {
    return names.has("required") ? `${label} is required.` : null;
  }
  const numeric = names.has("integer") || names.has("numeric");
  const measure = numeric ? Number(value) : [...value].length;
  const unit = numeric ? "" : " characters";

  for (const r of parsed.rules) {
    const [a = "", b = ""] = r.args;
    switch (r.name) {
      case "integer":
        if (!/^\s*[-+]?\d+\s*$/.test(value)) return `${label} must be a whole number.`;
        break;
      case "numeric":
        if (!NUMERIC_RE.test(value)) return `${label} must be a number.`;
        break;
      case "boolean":
        if (!["true", "false", "1", "0"].includes(value)) return `${label} must be true/false (or 1/0).`;
        break;
      case "alpha":
        if (!/^\p{L}+$/u.test(value)) return `${label} may only contain letters.`;
        break;
      case "alpha_num":
        if (!/^[\p{L}\p{N}]+$/u.test(value)) return `${label} may only contain letters and numbers.`;
        break;
      case "alpha_dash":
        if (!/^[\p{L}\p{N}_-]+$/u.test(value)) return `${label} may only contain letters, numbers, dashes and underscores.`;
        break;
      case "url":
        try {
          const u = new URL(value);
          if (!["http:", "https:", "ftp:"].includes(u.protocol)) return `${label} must be a valid URL.`;
        } catch {
          return `${label} must be a valid URL.`;
        }
        break;
      case "ip":
        if (!IPV4_RE.test(value) && !isIpv6(value)) return `${label} must be a valid IP address.`;
        break;
      case "ipv4":
        if (!IPV4_RE.test(value)) return `${label} must be a valid IPv4 address.`;
        break;
      case "ipv6":
        if (!isIpv6(value)) return `${label} must be a valid IPv6 address.`;
        break;
      case "min":
        if (measure < Number(a)) return `${label} must be at least ${a}${unit}.`;
        break;
      case "max":
        if (measure > Number(a)) return `${label} must be at most ${a}${unit}.`;
        break;
      case "between":
        if (measure < Number(a) || measure > Number(b)) return `${label} must be between ${a} and ${b}${unit}.`;
        break;
      case "size":
        if (measure !== Number(a)) return `${label} must be exactly ${a}${unit}.`;
        break;
      case "in":
        if (!r.args.includes(value)) return `${label} must be one of: ${r.args.join(", ")}.`;
        break;
      case "not_in":
        if (r.args.includes(value)) return `${label} can't be ${value}.`;
        break;
      case "digits":
        if (!/^\d+$/.test(value) || value.length !== Number(a)) return `${label} must be ${a} digits.`;
        break;
      case "digits_between":
        if (!/^\d+$/.test(value) || value.length < Number(a) || value.length > Number(b))
          return `${label} must be between ${a} and ${b} digits.`;
        break;
      case "starts_with":
        if (!r.args.some((p) => value.startsWith(p))) return `${label} must start with: ${r.args.join(", ")}.`;
        break;
      case "ends_with":
        if (!r.args.some((p) => value.endsWith(p))) return `${label} must end with: ${r.args.join(", ")}.`;
        break;
      case "regex":
        if (r.regex && !r.regex.test(value)) return `${label} has an invalid format.`;
        break;
      case "not_regex":
        if (r.regex?.test(value)) return `${label} has an invalid format.`;
        break;
    }
  }
  return null;
}

export function validateVariables(
  variables: readonly { key: string; name: string; default?: string; rules?: string }[],
  values: Record<string, string | undefined>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const v of variables) {
    const value = values[v.key] ?? v.default ?? "";
    const err = validateValue(v.name || v.key, value, v.rules);
    if (err) errors[v.key] = err;
  }
  return errors;
}
