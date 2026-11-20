import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, createServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OCR_LANGUAGES as RUNTIME_LANGUAGES, ocrAssetUrls } from '../src/ocr/assets';
import {
  OCR_CORE_VARIANTS,
  OCR_DIR,
  OCR_LANGUAGES,
  ocrAssetsPlugin,
  resolveOcrAssets,
} from './ocr-assets';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pretometru-ocr-assets-'));
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head></head><body><script type="module" src="/main.js"></script></body></html>',
  );
  await writeFile(join(root, 'main.js'), 'console.log(1);');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('resolveOcrAssets', () => {
  const assets = resolveOcrAssets();

  it('finds every file in node_modules, with unique names', async () => {
    expect(new Set(assets.map((asset) => asset.name)).size).toBe(assets.length);
    for (const asset of assets) expect((await stat(asset.file)).size).toBeGreaterThan(1000);
  });

  it('ships exactly what the runtime asks for (src/ocr/assets.ts)', () => {
    expect(OCR_LANGUAGES).toEqual(RUNTIME_LANGUAGES);
    const names = new Set(assets.map((asset) => asset.name));
    const urls = ocrAssetUrls('/pretometru/');

    expect(urls).toEqual({
      workerPath: `/pretometru/${OCR_DIR}/worker.min.js`,
      corePath: `/pretometru/${OCR_DIR}/core`,
      langPath: `/pretometru/${OCR_DIR}/lang`,
    });
    expect(names.has('worker.min.js')).toBe(true);
    for (const code of RUNTIME_LANGUAGES)
      expect(names.has(`lang/${code}.traineddata.gz`)).toBe(true);
    // tesseract.js appends one of these (LSTM only) to corePath depending on SIMD support
    for (const variant of [
      'tesseract-core-relaxedsimd-lstm',
      'tesseract-core-simd-lstm',
      'tesseract-core-lstm',
    ]) {
      expect(names.has(`core/${variant}.wasm.js`)).toBe(true);
      expect(OCR_CORE_VARIANTS).toContain(variant);
    }
  });
});

describe('ocrAssetsPlugin', () => {
  it('emits the engine to dist/ocr with stable names', async () => {
    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [ocrAssetsPlugin()],
      build: { write: false },
    });
    const outputs = Array.isArray(result)
      ? result.flatMap((r) => r.output)
      : 'output' in result
        ? result.output
        : [];

    for (const asset of resolveOcrAssets()) {
      const emitted = outputs.find((o) => o.fileName === `${OCR_DIR}/${asset.name}`);
      expect(emitted?.type, asset.name).toBe('asset');
      if (emitted?.type === 'asset') {
        expect(Buffer.from(emitted.source as Uint8Array).equals(await readFile(asset.file))).toBe(
          true,
        );
      }
    }
  }, 60_000);

  it('serves the same files from the dev server under the base path', async () => {
    const server = await createServer({
      root,
      base: '/pretometru/',
      configFile: false,
      logLevel: 'silent',
      appType: 'custom',
      plugins: [ocrAssetsPlugin()],
      server: { host: '127.0.0.1', port: 0 },
    });
    try {
      await server.listen();
      const address = server.httpServer?.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const origin = `http://127.0.0.1:${port}/pretometru/${OCR_DIR}`;

      const language = await fetch(`${origin}/lang/ron.traineddata.gz?v=1`);
      expect(language.status).toBe(200);
      expect(language.headers.get('content-type')).toBe('application/gzip');
      const ron = resolveOcrAssets().find((asset) => asset.name === 'lang/ron.traineddata.gz');
      expect(Buffer.from(await language.arrayBuffer()).equals(await readFile(ron!.file))).toBe(
        true,
      );

      const worker = await fetch(`${origin}/worker.min.js`);
      expect(worker.headers.get('content-type')).toBe('text/javascript');
      expect((await fetch(`${origin}/core/missing.wasm.js`)).status).toBe(404);
    } finally {
      await server.close();
    }
  }, 60_000);
});
