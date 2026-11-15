export const EDITOR_MAX_BYTES = 4 * 1024 * 1024;

export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

export function joinPath(dir: string, name: string): string {
  return normalizePath(`${dir}/${name}`);
}

export function parentDir(path: string): string {
  return normalizePath(`${normalizePath(path)}/..`);
}

export function basename(path: string): string {
  const p = normalizePath(path);
  return p === "/" ? "" : (p.split("/").pop() ?? "");
}

export function breadcrumbs(path: string): { name: string; path: string }[] {
  const parts = normalizePath(path).split("/").filter(Boolean);
  return [{ name: "/", path: "/" }, ...parts.map((name, i) => ({ name, path: `/${parts.slice(0, i + 1).join("/")}` }))];
}

export function isValidName(name: string): boolean {
  const n = name.trim();
  return n.length > 0 && n.length <= 255 && n !== "." && n !== ".." && !/[/\\\0]/.test(n);
}

const ARCHIVE_RE = /\.(zip|tar|tar\.gz|tgz)$/i;
export function isArchive(name: string): boolean {
  return ARCHIVE_RE.test(name);
}

export type EditorLanguage = "json" | "yaml" | "properties" | "toml" | "shell" | "javascript" | "xml" | "markdown" | "text";

export function languageFor(name: string): EditorLanguage {
  const n = name.toLowerCase();
  if (/\.(json|json5|mcmeta)$/.test(n)) return "json";
  if (/\.(ya?ml)$/.test(n)) return "yaml";
  if (/\.(properties|ini|cfg|conf|env)$/.test(n) || n === ".env") return "properties";
  if (/\.toml$/.test(n)) return "toml";
  if (/\.(sh|bash)$/.test(n) || n === "dockerfile") return "shell";
  if (/\.(m?js|cjs|ts|mts)$/.test(n)) return "javascript";
  if (/\.(xml|html?|svg)$/.test(n)) return "xml";
  if (/\.(md|markdown)$/.test(n)) return "markdown";
  return "text";
}

export function isEditable(file: { mime: string; size: number; file: boolean }): boolean {
  if (!file.file || file.size > EDITOR_MAX_BYTES) return false;
  const m = file.mime.toLowerCase();
  return (
    m.startsWith("text/") ||
    m === "inode/x-empty" ||
    m === "application/x-empty" ||
    /json|xml|yaml|toml|javascript|x-sh|shellscript|x-empty|properties/.test(m)
  );
}

export function isValidMode(mode: string): boolean {
  return /^[0-7]{3,4}$/.test(mode);
}
