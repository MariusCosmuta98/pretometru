import type { Page, PSM } from 'tesseract.js';
import { OCR_LANGUAGES, ocrAssetUrls, type OcrAssetUrls } from './assets';

export interface EngineConfig extends Partial<OcrAssetUrls> {
  /** Tesseract language codes joined with `+`. */
  languages: string;
  /** Page segmentation mode; `'6'` = one uniform block of text, which keeps a printed row together. */
  pageSegMode: string;
}

export interface EngineStatus {
  /** Tesseract.js phase, e.g. `loading tesseract core` or `recognizing text`. */
  status: string;
  /** 0..1 within that phase. */
  progress: number;
}

export interface RawEngine {
  recognize(image: Blob | Uint8Array): Promise<Page>;
  terminate(): Promise<void>;
}

export type EngineFactory = (
  config: EngineConfig,
  onStatus: (event: EngineStatus) => void,
) => Promise<RawEngine>;

export interface EngineHooks {
  signal?: AbortSignal;
  onStatus?: (event: EngineStatus) => void;
}

export interface EngineHost {
  /** Recognises one image; jobs are queued, the worker is created on first use and reused. */
  run(config: EngineConfig, image: Blob | Uint8Array, hooks?: EngineHooks): Promise<Page>;
  /** Terminates the worker now (it is also terminated after `idleMs` without work). */
  dispose(): Promise<void>;
}

export function defaultEngineConfig(): EngineConfig {
  return {
    ...ocrAssetUrls(import.meta.env.BASE_URL),
    languages: OCR_LANGUAGES.join('+'),
    pageSegMode: '6',
  };
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

/** Resolves like `promise`, but rejects as soon as `signal` aborts (and then runs `onAbort`). */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined, onAbort: () => void) {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      onAbort();
      reject(abortError(signal));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/**
 * Keeps one Tesseract worker alive between calls: starting it costs seconds (WASM + language
 * data), but it holds a few hundred MB, so it is terminated after `idleMs` without work and
 * whenever a job is aborted (the only way to cancel a running recognition).
 */
export function createEngineHost(factory: EngineFactory, { idleMs = 60_000 } = {}): EngineHost {
  let current: { key: string; engine: Promise<RawEngine> } | undefined;
  let onStatus: ((event: EngineStatus) => void) | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const disposeCurrent = async () => {
    clearTimeout(idleTimer);
    const stale = current;
    current = undefined;
    if (!stale) return;
    try {
      await (await stale.engine).terminate();
    } catch {
      // The worker never started, so there is nothing to terminate.
    }
  };

  const execute = async (config: EngineConfig, image: Blob | Uint8Array, hooks: EngineHooks) => {
    hooks.signal?.throwIfAborted();
    clearTimeout(idleTimer);

    const key = JSON.stringify(config);
    if (current && current.key !== key) await disposeCurrent();
    if (!current) {
      const engine = factory(config, (event) => onStatus?.(event));
      const created = { key, engine };
      current = created;
      // A worker that failed to start must not be cached: the next call retries.
      engine.catch(() => {
        if (current === created) current = undefined;
      });
    }

    const job = current;
    onStatus = hooks.onStatus;
    try {
      return await raceAbort(
        job.engine.then((engine) => engine.recognize(image)),
        hooks.signal,
        () => void disposeCurrent(),
      );
    } finally {
      onStatus = undefined;
      if (current === job) idleTimer = setTimeout(() => void disposeCurrent(), idleMs);
    }
  };

  return {
    run(config, image, hooks = {}) {
      const result = queue.then(() => execute(config, image, hooks));
      queue = result.catch(() => undefined);
      return result;
    },
    dispose: async () => {
      await queue;
      await disposeCurrent();
    },
  };
}

/**
 * Tesseract.js worker, LSTM engine only. In the browser every file comes from our own origin
 * (`defaultEngineConfig`); under Node (tests, the benchmark) the paths are left out and
 * Tesseract.js loads its own worker and core, with `langPath` pointing at a local folder.
 */
export const createTesseractEngine: EngineFactory = async (config, onStatus) => {
  // Lazy: the engine (and its 60 KB loader) must not weigh on the app shell.
  const { createWorker, OEM } = await import('tesseract.js');
  const { workerPath, corePath, langPath } = config;
  const worker = await createWorker(config.languages, OEM.LSTM_ONLY, {
    // Passing `undefined` would override Tesseract.js's own defaults, so only set what is given.
    ...(workerPath && { workerPath }),
    ...(corePath && { corePath }),
    ...(langPath && { langPath }),
    // A plain same-origin worker: no blob: URL, so `worker-src 'self'` is enough.
    workerBlobURL: false,
    // The service worker owns caching; Tesseract's own IndexedDB copy would double the storage.
    cacheMethod: 'none',
    gzip: true,
    logger: ({ status, progress }) => onStatus({ status, progress }),
    // Failures reach the caller through the rejected promises; without a handler Tesseract.js throws.
    errorHandler: () => undefined,
  });
  await worker.setParameters({
    tessedit_pageseg_mode: config.pageSegMode as PSM,
    // Keeps the wide gap between a product name and its price.
    preserve_interword_spaces: '1',
  });
  return {
    async recognize(image) {
      const result = await worker.recognize(image, {}, { text: true, blocks: true });
      return result.data;
    },
    async terminate() {
      await worker.terminate();
    },
  };
};

/** The engine shared by `recognizeImage`. */
export const sharedEngine = createEngineHost(createTesseractEngine);
