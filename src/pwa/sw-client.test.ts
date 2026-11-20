import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineStatus } from './engine-cache';
import { MESSAGE_ENGINES_PREPARE, MESSAGE_ENGINES_STATUS, type WorkerRequest } from './messages';
import {
  createEnginesClient,
  readOfflineReadiness,
  type OfflineReadiness,
  type ServiceWorkerHost,
} from './sw-client';

const ENGINES: EngineStatus[] = [{ id: 'pdf', files: 1, cached: 1, bytes: 100, cachedBytes: 100 }];

type Script = (message: WorkerRequest, reply: (data: unknown) => void) => void;

/** A host whose active worker runs `script`, like the real worker would, over the transferred port. */
function hostWith(script: Script): ServiceWorkerHost {
  return {
    controller: {},
    getRegistration: () =>
      Promise.resolve({
        active: {
          postMessage: (message, transfer) => {
            const port = transfer[0] as MessagePort;
            script(message, (data) => {
              port.postMessage(data);
            });
          },
        },
      }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('readOfflineReadiness', () => {
  const host = (
    registration: { active: object | null } | undefined,
    controller: unknown,
  ): ServiceWorkerHost => ({
    controller,
    getRegistration: () => Promise.resolve(registration as never),
  });

  it.each<[string, ServiceWorkerHost | undefined, OfflineReadiness]>([
    ['no service worker support', undefined, 'unsupported'],
    ['nothing registered (the dev server)', host(undefined, null), 'unregistered'],
    ['still installing', host({ active: null }, null), 'pending'],
    ['active but not yet controlling this page', host({ active: {} }, null), 'pending'],
    ['active and controlling: the app starts offline', host({ active: {} }, {}), 'ready'],
  ])('%s', async (_name, serviceWorker, expected) => {
    expect(await readOfflineReadiness(serviceWorker)).toBe(expected);
  });
});

describe('createEnginesClient', () => {
  it('asks the worker for the status of the engines', async () => {
    const received: WorkerRequest[] = [];
    const client = createEnginesClient(
      hostWith((message, reply) => {
        received.push(message);
        reply({ type: 'status', engines: ENGINES });
      }),
    );

    expect(await client.status()).toEqual(ENGINES);
    expect(received).toEqual([{ type: MESSAGE_ENGINES_STATUS }]);
  });

  it('prepares the engines and passes the progress on', async () => {
    const client = createEnginesClient(
      hostWith((message, reply) => {
        expect(message).toEqual({ type: MESSAGE_ENGINES_PREPARE });
        reply({
          type: 'progress',
          progress: { doneFiles: 1, totalFiles: 2, doneBytes: 10, totalBytes: 30 },
        });
        reply({
          type: 'progress',
          progress: { doneFiles: 2, totalFiles: 2, doneBytes: 30, totalBytes: 30 },
        });
        reply({ type: 'status', engines: ENGINES });
      }),
    );
    const seen: number[] = [];

    const engines = await client.prepare((progress) => seen.push(progress.doneFiles));

    expect(engines).toEqual(ENGINES);
    expect(seen).toEqual([1, 2]);
  });

  it('rejects with the reason the worker gives', async () => {
    const client = createEnginesClient(
      hostWith((_message, reply) => {
        reply({ type: 'error', message: 'ocr/worker.min.js: HTTP 503' });
      }),
    );

    await expect(client.prepare()).rejects.toThrow('ocr/worker.min.js: HTTP 503');
  });

  it('has no status, and cannot prepare, while no worker is active', async () => {
    const without: ServiceWorkerHost = {
      controller: null,
      getRegistration: () => Promise.resolve({ active: null }),
    };
    const client = createEnginesClient(without);
    expect(await client.status()).toBeUndefined();
    await expect(client.prepare()).rejects.toThrow('no active service worker');

    expect(await createEnginesClient(undefined).status()).toBeUndefined();
  });

  it('gives up on a worker that never answers', async () => {
    vi.useFakeTimers();
    const client = createEnginesClient(hostWith(() => undefined));

    const status = client.status();
    const rejected = expect(status).rejects.toThrow('did not answer');
    await vi.advanceTimersByTimeAsync(5_001);

    await rejected;
  });
});
