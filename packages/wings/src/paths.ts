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
  if (/\.(properties|ini|cfg|conf|env|lang)$/.test(n) || n === ".env") return "properties";
  if (/\.toml$/.test(n)) return "toml";
  if (/\.(sh|bash|bat|cmd|ps1)$/.test(n) || n === "dockerfile") return "shell";
  if (/\.(m?js|cjs|ts|mts|gradle|kts)$/.test(n)) return "javascript";
  if (/\.(xml|html?|svg)$/.test(n)) return "xml";
  if (/\.(md|markdown)$/.test(n)) return "markdown";
  return "text";
}

// Extensions that are never text. Everything else is offered to the editor: wings guesses mime types
// from the extension alone and reports many config formats (.properties, .mcmeta, .env, extensionless
// files, ...) as application/octet-stream, so a mime allowlist locks out files people need to edit.
// Anything binary that slips through is rejected on read (NUL byte / invalid UTF-8) with a download hint.
const BINARY_EXTENSIONS = [
  // archives & java
  "jar", "war", "class", "zip", "tar", "gz", "tgz", "xz", "bz2", "7z", "rar", "zst", "lz4",
  // minecraft / game data
  "dat", "dat_old", "mca", "mcr", "nbt", "schem", "schematic", "litematic",
  // databases
  "db", "sqlite", "sqlite3", "mv.db",
  // images, audio, video, fonts
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff",
  "ogg", "mp3", "wav", "flac", "mp4", "webm", "mkv",
  "ttf", "otf", "woff", "woff2",
  // executables & libraries
  "exe", "dll", "so", "dylib", "bin", "o", "a",
  // documents
  "pdf",
];
const BINARY_EXT_RE = new RegExp(`\\.(${BINARY_EXTENSIONS.map((e) => e.replace(".", "\\.")).join("|")})$`, "i");
const BINARY_MIME_RE = /^(image|audio|font)\//i;

export function isEditable(file: { name: string; mime: string; size: number; file: boolean }): boolean {
  if (!file.file || file.size > EDITOR_MAX_BYTES) return false;
  if (BINARY_EXT_RE.test(file.name)) return false;
  // svg is image/* but plain XML
  if (BINARY_MIME_RE.test(file.mime) && !/\.svg$/i.test(file.name)) return false;
  return true;
}

export function isValidMode(mode: string): boolean {
  return /^[0-7]{3,4}$/.test(mode);
}
