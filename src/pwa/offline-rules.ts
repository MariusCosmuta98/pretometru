/*
 * What the service worker precaches and what it caches on first use. Pure and free of `@/` imports,
 * so the service worker, the build guard (`config/offline-guard.ts`, run by `vite.config.ts`) and
 * the tests all read the same rules.
 */

/** A Workbox manifest entry: `url` is relative to the service worker, that is, to the app's base. */
export interface ManifestEntry {
  url: string;
  /** `null` when the file name already carries a content hash. */
  revision?: string | null | undefined;
  /** Size on disk. Added at build time to engine files, so Settings can say what a download costs. */
  bytes?: number | undefined;
}

export interface EngineRule {
  id: string;
  /** `path` is relative to the app's base, without query or fragment (`ocr/worker.min.js`). */
  matches: (path: string) => boolean;
}

/**
 * The heavy engines. They are never precached: the service worker stores each file the first time
 * it is requested (cache-first) and Settings can fetch all of them in one go. A file that matches no
 * rule is precached, and the build fails when a precached file is heavy (see the build guard), so a
 * renamed or new engine file cannot slip into the install step unnoticed.
 */
export const ENGINE_RULES = [
  // The pdf.js worker is an ES module worker (`.mjs`), about 1.3 MB.
  { id: 'pdf', matches: (path) => path.endsWith('.mjs') },
  // Tesseract.js worker, WASM cores and language data (config/ocr-assets.ts), about 16 MB.
  { id: 'ocr', matches: (path) => path.startsWith('ocr/') },
] as const satisfies readonly EngineRule[];

export type EngineId = (typeof ENGINE_RULES)[number]['id'];

export interface EngineEntry extends ManifestEntry {
  engine: EngineId;
}

/** Every cache of the engines starts with this; the rest of the name says which engine and version. */
export const ENGINE_CACHE_PREFIX = 'pretometru-engine-';

export function engineOf(path: string): EngineId | undefined {
  return ENGINE_RULES.find((rule) => rule.matches(path))?.id;
}

/**
 * Splits the manifest Workbox injected: the app shell is precached, the engines wait for first use.
 * vite-plugin-pwa appends the web manifest, the icons and `includeAssets` on top of what the glob
 * found, so a URL can come twice (with the same revision); Workbox would accept that, the engines'
 * download counts and cache names should not.
 */
export function splitManifest(entries: readonly ManifestEntry[]): {
  precache: ManifestEntry[];
  engines: EngineEntry[];
} {
  const precache: ManifestEntry[] = [];
  const engines: EngineEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    const engine = engineOf(entry.url);
    if (engine) engines.push({ ...entry, engine });
    else precache.push(entry);
  }
  return { precache, engines };
}

/** 32-bit FNV-1a, in hex: a cache key, not a security measure. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * One cache per engine, named after the files and revisions it should hold: an engine whose files
 * did not change keeps its cache across app updates (a 16 MB download is not repeated), one that
 * changed starts a new cache and the old one is deleted when the new worker activates.
 */
export function engineCacheName(engine: EngineId, entries: readonly EngineEntry[]): string {
  const own = entries
    .filter((entry) => entry.engine === engine)
    .map((entry) => `${entry.url}|${entry.revision ?? ''}`)
    .sort();
  return `${ENGINE_CACHE_PREFIX}${engine}-${fingerprint(own.join('\n'))}`;
}

/** `url` relative to the scope (the app's base), or `undefined` for another origin or path. */
export function relativeToScope(url: string | URL, scope: string): string | undefined {
  const target = new URL(url);
  const root = new URL(scope);
  if (target.origin !== root.origin || !target.pathname.startsWith(root.pathname)) return undefined;
  return decodeURIComponent(target.pathname.slice(root.pathname.length));
}
