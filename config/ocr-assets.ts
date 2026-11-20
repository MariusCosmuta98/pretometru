import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Folder below the Vite base that serves the OCR engine (`<base>ocr/...`). The names are stable
 * (not content-hashed) so a service worker can cache them by URL; `src/ocr/assets.ts` is the
 * runtime counterpart and must request exactly these paths.
 */
export const OCR_DIR = 'ocr';

export interface OcrAsset {
  /** Path below `ocr/`, forward slashes. */
  name: string;
  /** Absolute path of the source file inside node_modules. */
  file: string;
  contentType: string;
}

const require = createRequire(import.meta.url);

const packageDir = (resolveFrom: NodeJS.Require, name: string) =>
  dirname(resolveFrom.resolve(`${name}/package.json`));

// tesseract.js feature-detects relaxed SIMD, then SIMD, and loads `<variant>.wasm.js` (the WASM
// is inlined in that file). Only the LSTM engine is used, so the legacy variants are not shipped.
export const OCR_CORE_VARIANTS = [
  'tesseract-core-relaxedsimd-lstm',
  'tesseract-core-simd-lstm',
  'tesseract-core-lstm',
] as const;
export const OCR_LANGUAGES = ['ron', 'eng'] as const;
// Integer-quantised "best" LSTM-only models: the smallest accurate ones (about 1.6 MB for ron).
const TRAINED_DATA_VERSION = '4.0.0_best_int';

/** Every file the OCR engine loads at runtime, resolved from node_modules. */
export function resolveOcrAssets(): OcrAsset[] {
  const tesseract = packageDir(require, 'tesseract.js');
  // The core has to match the tesseract.js that loads it, so resolve it from there.
  const core = packageDir(createRequire(join(tesseract, 'package.json')), 'tesseract.js-core');

  return [
    {
      name: 'worker.min.js',
      file: join(tesseract, 'dist', 'worker.min.js'),
      contentType: 'text/javascript',
    },
    ...OCR_CORE_VARIANTS.map((variant) => ({
      name: `core/${variant}.wasm.js`,
      file: join(core, `${variant}.wasm.js`),
      contentType: 'text/javascript',
    })),
    ...OCR_LANGUAGES.map((code) => ({
      name: `lang/${code}.traineddata.gz`,
      file: join(
        packageDir(require, `@tesseract.js-data/${code}`),
        TRAINED_DATA_VERSION,
        `${code}.traineddata.gz`,
      ),
      contentType: 'application/gzip',
    })),
  ];
}

/**
 * Serves the OCR engine from our own origin (plan §11: no CDN at runtime): copies the files to
 * `dist/ocr/` at build time instead of committing binaries, and serves them from node_modules in
 * the dev server.
 */
export function ocrAssetsPlugin(assets: readonly OcrAsset[] = resolveOcrAssets()): Plugin {
  let base = '/';

  return {
    name: 'pretometru:ocr-assets',
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      const byPath = new Map(assets.map((asset) => [`/${asset.name}`, asset]));
      server.middlewares.use(`${base}${OCR_DIR}`, (req, res, next) => {
        const asset = byPath.get((req.url ?? '').split('?')[0] ?? '');
        if (!asset) return next();
        res.setHeader('Content-Type', asset.contentType);
        createReadStream(asset.file).on('error', next).pipe(res);
      });
    },
    async generateBundle() {
      for (const asset of assets) {
        this.emitFile({
          type: 'asset',
          fileName: `${OCR_DIR}/${asset.name}`,
          source: await readFile(asset.file),
        });
      }
    },
  };
}
