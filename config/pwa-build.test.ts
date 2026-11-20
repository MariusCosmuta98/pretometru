import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { splitManifest, type ManifestEntry } from '../src/pwa/offline-rules';
import { OFFLINE_LIMITS } from './offline-guard';

/*
 * The real vite.config.ts, built for production: what the service worker is given to precache and
 * what it leaves for first use. The offline guard already fails the build itself (it runs on the final
 * manifest); this pins what a person would check by hand after a change to the PWA setup.
 * The browser side of it is e2e/ (npm run e2e).
 */

let outDir: string;
let swSource: string;
let manifest: Array<ManifestEntry & { bytes?: number }>;
let sizes: Map<string, number>;

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).replaceAll('\\', '/'));
}

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'pretometru-pwa-build-'));
  vi.stubEnv('NODE_ENV', 'production');
  await build({
    configFile: resolve('vite.config.ts'),
    mode: 'production',
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
  vi.unstubAllEnvs();

  swSource = await readFile(join(outDir, 'sw.js'), 'utf8');
  // Workbox writes its manifest into the worker as JSON.
  const injected = /\[\{"(?:bytes|revision|url)":[^\]]*\}\]/.exec(swSource)?.[0];
  manifest = JSON.parse(injected ?? '[]') as typeof manifest;
  sizes = new Map(
    await Promise.all(
      (await listFiles(outDir))
        .filter((file) => file !== 'sw.js')
        .map(async (file) => [file, (await stat(join(outDir, file))).size] as const),
    ),
  );
}, 180_000);

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
});

describe('the production build offline', () => {
  it('lists every file of the build for the service worker, so none is missing offline', () => {
    expect([...new Set(manifest.map((entry) => entry.url))].sort()).toEqual(
      [...sizes.keys()].sort(),
    );
  });

  it('never lists a file twice with different revisions: Workbox refuses to install such a worker', () => {
    const revisions = new Map<string, string | null | undefined>();
    for (const { url, revision } of manifest) {
      if (revisions.has(url)) expect(revision, url).toBe(revisions.get(url));
      revisions.set(url, revision);
    }
  });

  it('precaches the app shell and every route chunk, within the install budget', () => {
    const { precache } = splitManifest(manifest);
    const urls = precache.map((entry) => entry.url);

    expect(urls).toContain('index.html');
    expect(urls).toContain('manifest.webmanifest');
    // Every lazy chunk of every screen, not only the entry point.
    expect(urls.filter((url) => /^assets\/.*Screen-.*\.js$/.test(url)).length).toBeGreaterThan(5);
    expect(urls.filter((url) => url.endsWith('.css')).length).toBeGreaterThan(0);

    const bytes = urls.reduce((total, url) => total + (sizes.get(url) ?? 0), 0);
    expect(bytes).toBeLessThan(OFFLINE_LIMITS.maxPrecacheBytes);
  });

  it('leaves the pdf.js worker and the OCR engine for first use, with their sizes', async () => {
    const { engines } = splitManifest(manifest);

    const byEngine = (id: string) => engines.filter((entry) => entry.engine === id);
    expect(byEngine('pdf').map((entry) => entry.url)).toEqual([
      expect.stringMatching(/^assets\/pdf\.worker\.min-.*\.mjs$/),
    ]);
    expect(byEngine('ocr').map((entry) => entry.url)).toEqual(
      expect.arrayContaining(['ocr/worker.min.js', expect.stringMatching(/^ocr\/lang\/ron\./)]),
    );
    for (const entry of engines) {
      expect((await stat(join(outDir, entry.url))).size, entry.url).toBe(entry.bytes);
    }
  });

  it('keeps the update prompt: a new worker waits for SKIP_WAITING', () => {
    expect(swSource).toContain('SKIP_WAITING');
    // `registerType: 'prompt'`: nothing skips the waiting phase on its own.
    expect(swSource.match(/skipWaiting\(/g)).toHaveLength(1);
  });

  it('declares the Web Share Target for PDFs and images, inside the app scope', async () => {
    const webManifest = JSON.parse(
      await readFile(join(outDir, 'manifest.webmanifest'), 'utf8'),
    ) as { scope: string; share_target: Record<string, unknown> };

    expect(webManifest.share_target).toEqual({
      action: '/pretometru/share-target',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: { files: [{ name: 'files', accept: ['application/pdf', 'image/*'] }] },
    });
    expect(String(webManifest.share_target.action).startsWith(webManifest.scope)).toBe(true);
  });
});
