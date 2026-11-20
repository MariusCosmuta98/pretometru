import type { Page } from 'tesseract.js';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  createEngineHost,
  type EngineConfig,
  type EngineFactory,
  type EngineStatus,
  type RawEngine,
} from './engine';

const config: EngineConfig = {
  workerPath: '/ocr/worker.min.js',
  corePath: '/ocr/core',
  langPath: '/ocr/lang',
  languages: 'ron+eng',
  pageSegMode: '6',
};
const page = (text: string) => ({ text }) as Page;
const image = new Uint8Array([1]);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FakeEngine extends RawEngine {
  terminated: boolean;
  recognize: Mock<RawEngine['recognize']>;
}

function fakeFactory(
  recognize: (call: number) => Promise<Page> = () => Promise.resolve(page('ok')),
) {
  let calls = 0;
  const engines: FakeEngine[] = [];
  const reporters: Array<(event: EngineStatus) => void> = [];
  const factory = vi.fn<EngineFactory>((_config, onStatus) => {
    reporters.push(onStatus);
    const engine: FakeEngine = {
      terminated: false,
      recognize: vi.fn<RawEngine['recognize']>(() => recognize(++calls)),
      terminate: () => {
        engine.terminated = true;
        return Promise.resolve();
      },
    };
    engines.push(engine);
    return Promise.resolve(engine);
  });
  return { factory, engines, reporters };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createEngineHost', () => {
  it('starts the worker once and reuses it for later jobs', async () => {
    const { factory, engines } = fakeFactory();
    const host = createEngineHost(factory);

    await host.run(config, image);
    await host.run(config, image);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(engines[0]?.recognize).toHaveBeenCalledTimes(2);
  });

  it('runs jobs one at a time, in call order', async () => {
    const first = deferred<Page>();
    const { factory, engines } = fakeFactory((call) =>
      call === 1 ? first.promise : Promise.resolve(page('second')),
    );
    const host = createEngineHost(factory);

    const a = host.run(config, image);
    const b = host.run(config, image);
    await vi.advanceTimersByTimeAsync(0);
    expect(engines[0]?.recognize).toHaveBeenCalledTimes(1);

    first.resolve(page('first'));
    expect((await a).text).toBe('first');
    expect((await b).text).toBe('second');
  });

  it('terminates the worker after the idle time and starts a new one afterwards', async () => {
    const { factory, engines } = fakeFactory();
    const host = createEngineHost(factory, { idleMs: 1000 });

    await host.run(config, image);
    await vi.advanceTimersByTimeAsync(999);
    expect(engines[0]?.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(engines[0]?.terminated).toBe(true);

    await host.run(config, image);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('does not terminate a worker that is still busy when the idle time passes', async () => {
    const slow = deferred<Page>();
    const { factory, engines } = fakeFactory(() => slow.promise);
    const host = createEngineHost(factory, { idleMs: 1000 });

    const job = host.run(config, image);
    await vi.advanceTimersByTimeAsync(5000);
    expect(engines[0]?.terminated).toBe(false);
    slow.resolve(page('done'));
    await job;
  });

  it('terminates the worker when a running job is aborted and recovers on the next job', async () => {
    const never = new Promise<Page>(() => undefined);
    const { factory, engines } = fakeFactory((call) =>
      call === 1 ? never : Promise.resolve(page('ok')),
    );
    const host = createEngineHost(factory);
    const controller = new AbortController();

    const job = host.run(config, image, { signal: controller.signal });
    const assertion = expect(job).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(0);
    expect(engines[0]?.terminated).toBe(true);

    expect((await host.run(config, image)).text).toBe('ok');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('rejects an already aborted call without starting a worker', async () => {
    const { factory } = fakeFactory();
    const host = createEngineHost(factory);
    const controller = new AbortController();
    controller.abort(new Error('stop'));

    await expect(host.run(config, image, { signal: controller.signal })).rejects.toThrow('stop');
    expect(factory).not.toHaveBeenCalled();
  });

  it('does not cache a worker that failed to start', async () => {
    let attempts = 0;
    const engine: RawEngine = {
      recognize: () => Promise.resolve(page('ok')),
      terminate: () => Promise.resolve(),
    };
    const factory: EngineFactory = () =>
      ++attempts === 1 ? Promise.reject(new Error('404')) : Promise.resolve(engine);
    const host = createEngineHost(factory);

    await expect(host.run(config, image)).rejects.toThrow('404');
    expect((await host.run(config, image)).text).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('replaces the worker when the configuration changes', async () => {
    const { factory, engines } = fakeFactory();
    const host = createEngineHost(factory);

    await host.run(config, image);
    await host.run({ ...config, languages: 'eng' }, image);

    expect(factory).toHaveBeenCalledTimes(2);
    expect(engines[0]?.terminated).toBe(true);
  });

  it('forwards engine status events only to the job that is running', async () => {
    const { factory, reporters } = fakeFactory();
    const host = createEngineHost(factory);
    const seen: EngineStatus[] = [];

    await host.run(config, image, { onStatus: (event) => seen.push(event) });
    reporters[0]?.({ status: 'late', progress: 1 });

    expect(seen).toEqual([]);
  });

  it('dispose terminates the worker', async () => {
    const { factory, engines } = fakeFactory();
    const host = createEngineHost(factory);
    await host.run(config, image);

    await host.dispose();

    expect(engines[0]?.terminated).toBe(true);
  });
});
