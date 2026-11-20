import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkOfflineBuild, OFFLINE_LIMITS, offlineGuard } from './offline-guard';

const MB = 1024 * 1024;
const entry = (url: string, size: number) => ({ url, revision: null, size });

const SHELL = [
  entry('index.html', 2_000),
  entry('manifest.webmanifest', 700),
  entry('pwa-192x192.png', 5_000),
  entry('assets/index-AAA.js', 330_000),
  entry('assets/pdf-BBB.js', 444_000),
  entry('assets/index-CCC.css', 31_000),
];
const ENGINES = [
  entry('assets/pdf.worker.min-DDD.mjs', 1.3 * MB),
  entry('ocr/worker.min.js', 111_000),
  entry('ocr/core/tesseract-core-lstm.wasm.js', 3.9 * MB),
  entry('ocr/lang/ron.traineddata.gz', 1.7 * MB),
];

const build = (manifest = [...SHELL, ...ENGINES], extra: string[] = []) => ({
  manifest,
  emitted: [...manifest.map((item) => item.url), 'sw.js', ...extra],
});

describe('checkOfflineBuild', () => {
  it('accepts a build whose shell is precached and whose engines match a rule', () => {
    expect(checkOfflineBuild(build())).toEqual({ problems: [], warnings: [] });
  });

  it('fails when an engine moves to a folder that no rule knows: it would be downloaded at install', () => {
    const renamed = ENGINES.map((item) => ({
      ...item,
      url: item.url.replace(/^ocr\//, 'engines/tesseract/'),
    }));

    const { problems } = checkOfflineBuild(build([...SHELL, ...renamed]));

    // The two heavy files, and the whole of it no longer fits the install budget.
    expect(problems.filter((problem) => problem.includes('too heavy'))).toHaveLength(2);
    expect(problems.some((problem) => problem.includes('over the 4.0 MiB budget'))).toBe(true);
    expect(problems.join('\n')).toContain(
      'engines/tesseract/core/tesseract-core-lstm.wasm.js (3.9 MiB)',
    );
    expect(problems.join('\n')).toContain('engines/tesseract/lang/ron.traineddata.gz');
    expect(problems.join('\n')).toContain('ENGINE_RULES in src/pwa/offline-rules.ts');
  });

  it('fails when the pdf.js worker stops being an .mjs file', () => {
    const renamed = ENGINES.map((item) =>
      item.url.endsWith('.mjs') ? { ...item, url: 'assets/pdf.worker.min-DDD.js' } : item,
    );

    const { problems } = checkOfflineBuild(build([...SHELL, ...renamed]));

    expect(problems).toEqual([expect.stringContaining('assets/pdf.worker.min-DDD.js (1.3 MiB)')]);
  });

  it('fails when the app shell outgrows the install budget, even with no single huge file', () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      entry(`assets/chunk-${index}.js`, 800_000),
    );

    const { problems } = checkOfflineBuild(build([...SHELL, ...many, ...ENGINES]));

    expect(problems).toEqual([
      expect.stringMatching(/The precache is 5\.\d MiB, over the 4\.0 MiB budget/),
    ]);
  });

  it('fails for a file of the build that is not in the offline manifest', () => {
    const { problems } = checkOfflineBuild(build(undefined, ['assets/model.bin']));

    expect(problems).toEqual([
      expect.stringContaining(
        'assets/model.bin is in the build output but not in the offline manifest',
      ),
    ]);
  });

  it('does not expect the service worker or source maps to be available offline', () => {
    expect(
      checkOfflineBuild(build(undefined, ['sw.js', 'assets/index-AAA.js.map'])).problems,
    ).toEqual([]);
  });

  it('warns about an engine rule that matches nothing in the build', () => {
    const { problems, warnings } = checkOfflineBuild(
      build([...SHELL, ...ENGINES.filter((item) => !item.url.endsWith('.mjs'))]),
    );

    expect(problems).toEqual([]);
    expect(warnings).toEqual([expect.stringContaining('"pdf" engine rule matches no file')]);
  });

  it('has limits that leave room for the shell to grow, yet keep every engine file out', () => {
    expect(OFFLINE_LIMITS.maxPrecacheFileBytes).toBeLessThan(1.3 * MB);
    expect(OFFLINE_LIMITS.maxPrecacheBytes).toBeGreaterThan(3 * 1.25 * MB);
  });
});

describe('offlineGuard', () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  async function guardFor(files: string[]) {
    root = await mkdtemp(join(tmpdir(), 'pretometru-guard-'));
    for (const file of files) {
      await mkdir(join(root, 'dist', file, '..'), { recursive: true });
      await writeFile(join(root, 'dist', file), 'x');
    }
    const guard = offlineGuard();
    const configResolved = guard.plugin.configResolved as (config: unknown) => void;
    configResolved({ root, build: { outDir: 'dist' } });
    return guard.transform;
  }

  const files = [...SHELL, ...ENGINES].map((item) => item.url);

  it('records the size of each engine file and leaves the shell entries alone', async () => {
    const transform = await guardFor(files);

    const result = await transform([...SHELL, ...ENGINES]);

    expect(result.warnings).toEqual([]);
    const byUrl = new Map(result.manifest.map((item) => [item.url, item]));
    expect(byUrl.get('ocr/worker.min.js')).toMatchObject({ bytes: 111_000 });
    expect(byUrl.get('assets/pdf.worker.min-DDD.mjs')).toMatchObject({ bytes: 1.3 * MB });
    expect(byUrl.get('index.html')).not.toHaveProperty('bytes');
  });

  it('stops the build with every problem listed, and reads the output folder to find files Workbox skipped', async () => {
    const transform = await guardFor([...files, 'assets/skipped-because-too-big.bin']);

    await expect(transform([...SHELL, ...ENGINES])).rejects.toThrow(
      /The offline build is broken:\n- assets\/skipped-because-too-big\.bin is in the build output/,
    );
  });
});
