export const EGG_FEATURES = ["eula", "java_version", "pid_limit"] as const;
export type EggFeature = (typeof EGG_FEATURES)[number];

export const FEATURE_LABELS: Record<EggFeature, string> = {
  eula: "EULA prompt (Minecraft)",
  java_version: "Java version switcher",
  pid_limit: "Process/thread limit help",
};

const MATCHERS: Record<EggFeature, string[]> = {
  eula: ["you need to agree to the eula in order to run the server"],
  java_version: [
    "minecraft 1.17 requires running the server with java 16 or above",
    "minecraft 1.18 requires running the server with java 17 or above",
    "requires running the server with java",
    "java.lang.unsupportedclassversionerror",
    "unsupported major.minor version",
    "has been compiled by a more recent version of the java runtime",
  ],
  pid_limit: [
    "pthread_create failed",
    "failed to create thread",
    "unable to create thread",
    "unable to create native thread",
    "unable to create new native thread",
    'exception in thread "craft async scheduler management thread"',
  ],
};

export function isEggFeature(f: string): f is EggFeature {
  return (EGG_FEATURES as readonly string[]).includes(f);
}

export function parseJavaRequirement(lines: readonly string[]): { required: number | null; current: number | null } {
  let required: number | null = null;
  let current: number | null = null;
  for (const line of lines) {
    const l = line.toLowerCase();
    const cls = /class file version (\d+)(?:\.\d+)?/.exec(l);
    if (cls && l.includes("more recent version")) required = Math.max(required ?? 0, Number(cls[1]) - 44);
    const upTo = /class file versions up to (\d+)(?:\.\d+)?/.exec(l);
    if (upTo) current = Number(upTo[1]) - 44;
    const needs = /requires running the server with java (\d+)/.exec(l);
    if (needs) required = Math.max(required ?? 0, Number(needs[1]));
    const major = /unsupported major\.minor version (\d+)/.exec(l);
    if (major) required = Math.max(required ?? 0, Number(major[1]) - 44);
  }
  return { required: required && required > 0 ? required : null, current: current && current > 0 ? current : null };
}

export function javaVersionOf(label: string, image: string): number | null {
  const m = /java[_\- ]?(\d+)/i.exec(image) ?? /java[_\- ]?(\d+)/i.exec(label);
  return m ? Number(m[1]) : null;
}

export function pickJavaImage(
  choices: Record<string, string>,
  required: number,
): { label: string; image: string; version: number } | null {
  let best: { label: string; image: string; version: number } | null = null;
  for (const [label, image] of Object.entries(choices)) {
    const version = javaVersionOf(label, image);
    if (version !== null && version >= required && (!best || version < best.version)) best = { label, image, version };
  }
  return best;
}

export function guessJavaImage(choices: Record<string, string>, version: number): string | null {
  let newest: { image: string; v: number } | null = null;
  for (const [label, image] of Object.entries(choices)) {
    const v = javaVersionOf(label, image);
    if (v !== null && /java[_-]?\d+/i.test(image) && (!newest || v > newest.v)) newest = { image, v };
  }
  return newest ? newest.image.replace(/(java[_-]?)\d+/i, `$1${version}`) : null;
}

export function matchFeature(line: string, enabled: readonly string[]): EggFeature | null {
  const l = line.toLowerCase();
  for (const f of EGG_FEATURES) {
    if (enabled.includes(f) && MATCHERS[f].some((m) => l.includes(m))) return f;
  }
  return null;
}
