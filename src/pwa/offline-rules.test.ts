import { describe, expect, it } from 'vitest';
import { ocrAssetUrls } from '@/ocr/assets';
import {
  ENGINE_CACHE_PREFIX,
  engineCacheName,
  engineOf,
  relativeToScope,
  splitManifest,
  type EngineEntry,
} from './offline-rules';

const SCOPE = 'https://example.test/pretometru/';

describe('engineOf', () => {
  it('knows the pdf.js worker and the OCR files, and nothing else', () => {
    expect(engineOf('assets/pdf.worker.min-CIqJB0yW.mjs')).toBe('pdf');
    expect(engineOf('ocr/worker.min.js')).toBe('ocr');
    expect(engineOf('ocr/core/tesseract-core-simd-lstm.wasm.js')).toBe('ocr');
    expect(engineOf('ocr/lang/ron.traineddata.gz')).toBe('ocr');

    expect(engineOf('index.html')).toBeUndefined();
    expect(engineOf('assets/index-M9ZT6EC4.js')).toBeUndefined();
    expect(engineOf('assets/ocr-Qvabs43R.js')).toBeUndefined();
    expect(engineOf('manifest.webmanifest')).toBeUndefined();
  });

  it('covers every URL that the OCR runtime requests (src/ocr/assets.ts), so a rename cannot break offline OCR', () => {
    const { workerPath, corePath, langPath } = ocrAssetUrls('/pretometru/');
    const requested = [
      workerPath,
      // Tesseract.js appends one of these to the core path, depending on SIMD support.
      ...['relaxedsimd-lstm', 'simd-lstm', 'lstm'].map(
        (variant) => `${corePath}/tesseract-core-${variant}.wasm.js`,
      ),
      ...['ron', 'eng'].map((code) => `${langPath}/${code}.traineddata.gz`),
    ];

    for (const path of requested) {
      const relative = relativeToScope(new URL(path, SCOPE), SCOPE);
      expect(relative !== undefined && engineOf(relative), path).toBe('ocr');
    }
  });
});

describe('splitManifest', () => {
  it('precaches the shell and sets the engines apart, tagged with their engine', () => {
    const { precache, engines } = splitManifest([
      { url: 'index.html', revision: 'a' },
      { url: 'assets/pdf.worker.min-CIqJB0yW.mjs', revision: null, bytes: 10 },
      { url: 'assets/index-M9ZT6EC4.js', revision: null },
      { url: 'ocr/worker.min.js', revision: 'b', bytes: 5 },
    ]);

    expect(precache.map((entry) => entry.url)).toEqual(['index.html', 'assets/index-M9ZT6EC4.js']);
    expect(engines.map((entry) => [entry.url, entry.engine])).toEqual([
      ['assets/pdf.worker.min-CIqJB0yW.mjs', 'pdf'],
      ['ocr/worker.min.js', 'ocr'],
    ]);
  });

  it('lists a file once even when vite-plugin-pwa adds it on top of the glob', () => {
    const { precache, engines } = splitManifest([
      { url: 'manifest.webmanifest', revision: 'm1' },
      { url: 'ocr/worker.min.js', revision: 'b', bytes: 5 },
      { url: 'manifest.webmanifest', revision: 'm1' },
      { url: 'ocr/worker.min.js', revision: 'b' },
    ]);

    expect(precache).toEqual([{ url: 'manifest.webmanifest', revision: 'm1' }]);
    expect(engines).toEqual([{ url: 'ocr/worker.min.js', revision: 'b', bytes: 5, engine: 'ocr' }]);
  });
});

describe('engineCacheName', () => {
  const entries: EngineEntry[] = [
    { url: 'ocr/worker.min.js', revision: 'b1', engine: 'ocr' },
    { url: 'ocr/lang/ron.traineddata.gz', revision: 'r1', engine: 'ocr' },
    { url: 'assets/pdf.worker.min-AAA.mjs', revision: null, engine: 'pdf' },
  ];

  it('is stable for the same files, whatever their order', () => {
    expect(engineCacheName('ocr', entries)).toBe(engineCacheName('ocr', [...entries].reverse()));
    expect(engineCacheName('ocr', entries)).toMatch(
      new RegExp(`^${ENGINE_CACHE_PREFIX}ocr-[0-9a-f]{8}$`),
    );
  });

  it('changes when a file of that engine changes, and only then', () => {
    const changedOcr = entries.map((entry) =>
      entry.url === 'ocr/worker.min.js' ? { ...entry, revision: 'b2' } : entry,
    );
    expect(engineCacheName('ocr', changedOcr)).not.toBe(engineCacheName('ocr', entries));
    expect(engineCacheName('pdf', changedOcr)).toBe(engineCacheName('pdf', entries));

    const newWorker = entries.map((entry) =>
      entry.engine === 'pdf' ? { ...entry, url: 'assets/pdf.worker.min-BBB.mjs' } : entry,
    );
    expect(engineCacheName('pdf', newWorker)).not.toBe(engineCacheName('pdf', entries));
    expect(engineCacheName('ocr', newWorker)).toBe(engineCacheName('ocr', entries));
  });
});

describe('relativeToScope', () => {
  it('returns the path below the scope, without query or fragment', () => {
    expect(
      relativeToScope('https://example.test/pretometru/ocr/lang/ron.traineddata.gz?v=1', SCOPE),
    ).toBe('ocr/lang/ron.traineddata.gz');
    expect(relativeToScope('https://example.test/pretometru/', SCOPE)).toBe('');
  });

  it('is undefined for another origin or another path', () => {
    expect(
      relativeToScope('https://cdn.example.test/pretometru/ocr/worker.min.js', SCOPE),
    ).toBeUndefined();
    expect(relativeToScope('https://example.test/other/ocr/worker.min.js', SCOPE)).toBeUndefined();
  });
});
