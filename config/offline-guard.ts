import { readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { ManifestTransform } from 'workbox-build';
import { ENGINE_RULES, engineOf, type ManifestEntry } from '../src/pwa/offline-rules.ts';

/*
 * Build-time guard for the offline build. The service worker precaches the app shell and caches the
 * engines (pdf.js worker, OCR) on first use (`src/pwa/offline-rules.ts`). Offline import breaks
 * silently when an engine file stops matching a rule (an engine moves to another folder, pdf.js
 * changes the worker's extension): it would be precached, or not available offline at all. This runs
 * on the final Workbox manifest, so `npm run build` fails with a message that says what to change.
 */

export interface OfflineLimits {
  /** The biggest file the install step may download; heavier files belong to an engine rule. */
  maxPrecacheFileBytes: number;
  /** Everything the install step downloads (the app shell: HTML, scripts, styles, icons). */
  maxPrecacheBytes: number;
}

export const OFFLINE_LIMITS: OfflineLimits = {
  maxPrecacheFileBytes: 1024 * 1024,
  maxPrecacheBytes: 4 * 1024 * 1024,
};

export interface OfflineBuild {
  /** What Workbox matched: `url` relative to the build output, `size` in bytes. */
  manifest: ReadonlyArray<ManifestEntry & { size: number }>;
  /** Every file of the build output, relative to it, with forward slashes. */
  emitted: readonly string[];
}

/** Files that are not meant to be available offline. */
const NOT_CACHED = [/^sw\.js$/, /\.map$/];

const mebibytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

export function checkOfflineBuild(
  { manifest, emitted }: OfflineBuild,
  limits: OfflineLimits = OFFLINE_LIMITS,
): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  const listed = new Set(manifest.map((entry) => entry.url));

  for (const file of emitted) {
    if (listed.has(file) || NOT_CACHED.some((pattern) => pattern.test(file))) continue;
    problems.push(
      `${file} is in the build output but not in the offline manifest, so it would be missing offline ` +
        `(a file over the size limit, or one that the globPatterns of vite.config.ts do not match)`,
    );
  }

  const precached = manifest.filter((entry) => engineOf(entry.url) === undefined);
  for (const entry of precached) {
    if (entry.size > limits.maxPrecacheFileBytes) {
      problems.push(
        `${entry.url} (${mebibytes(entry.size)}) is too heavy for the install step. Engine files are cached ` +
          `on first use instead: add a rule for it to ENGINE_RULES in src/pwa/offline-rules.ts`,
      );
    }
  }
  const total = precached.reduce((sum, entry) => sum + entry.size, 0);
  if (total > limits.maxPrecacheBytes) {
    problems.push(
      `The precache is ${mebibytes(total)}, over the ${mebibytes(limits.maxPrecacheBytes)} budget: ` +
        `split or lazy-load what grew, or cache it on first use (ENGINE_RULES in src/pwa/offline-rules.ts)`,
    );
  }

  for (const rule of ENGINE_RULES) {
    if (!emitted.some((file) => rule.matches(file))) {
      warnings.push(
        `The "${rule.id}" engine rule matches no file of the build: is it still needed?`,
      );
    }
  }
  return { problems, warnings };
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(directory, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/'),
    )
    .sort();
}

/**
 * The plugin only learns where the build writes to; the check itself is `transform`, which goes into
 * the Workbox `manifestTransforms`. It also records each engine file's size, which Settings shows
 * before it downloads them.
 */
export function offlineGuard(limits: OfflineLimits = OFFLINE_LIMITS): {
  plugin: Plugin;
  transform: ManifestTransform;
} {
  let outDir = resolve('dist');

  const plugin: Plugin = {
    name: 'pretometru:offline-guard',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
  };

  const transform: ManifestTransform = async (manifest) => {
    const { problems, warnings } = checkOfflineBuild(
      { manifest, emitted: await listFiles(outDir) },
      limits,
    );
    if (problems.length > 0) {
      throw new Error(`The offline build is broken:\n- ${problems.join('\n- ')}`);
    }
    return {
      warnings,
      manifest: manifest.map((entry) =>
        engineOf(entry.url) === undefined ? entry : { ...entry, bytes: entry.size },
      ),
    };
  };

  return { plugin, transform };
}
