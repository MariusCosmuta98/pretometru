import type { EngineStatus, PrepareProgress } from './engine-cache';
import {
  MESSAGE_ENGINES_PREPARE,
  MESSAGE_ENGINES_STATUS,
  type WorkerReply,
  type WorkerRequest,
} from './messages';

/*
 * The page's side of the conversation with the service worker (`sw.ts`): is the app ready to run
 * offline, which engines are stored, and "download them now".
 */

export type OfflineReadiness =
  /** No service worker support (an old browser, or a page that is not secure). */
  | 'unsupported'
  /** Supported, but nothing is registered: the dev server, or a build without the worker. */
  | 'unregistered'
  /** Registered, still installing, or not yet controlling this page: reload once. */
  | 'pending'
  /** Active and in control: the shell is cached and the app starts without a network. */
  | 'ready';

interface WorkerLike {
  postMessage(message: WorkerRequest, transfer: Transferable[]): void;
}

export interface ServiceWorkerHost {
  controller: unknown;
  getRegistration(): Promise<{ active: WorkerLike | null } | undefined>;
}

export interface EnginesClient {
  /** `undefined` while there is no active service worker to ask. */
  status(): Promise<EngineStatus[] | undefined>;
  /** Downloads every engine file that is missing, reporting progress; rejects with the reason it stopped. */
  prepare(onProgress?: (progress: PrepareProgress) => void): Promise<EngineStatus[]>;
}

const STATUS_TIMEOUT_MS = 5_000;
// Between two messages: a 4 MB engine file on a weak connection can take a while.
const PREPARE_IDLE_MS = 180_000;

export async function readOfflineReadiness(
  host: ServiceWorkerHost | undefined = browserHost(),
): Promise<OfflineReadiness> {
  if (!host) return 'unsupported';
  const registration = await host.getRegistration();
  if (!registration) return 'unregistered';
  return registration.active && host.controller ? 'ready' : 'pending';
}

// `navigator.serviceWorker` is missing in insecure contexts and old browsers, which the types do not say.
function browserHost(): ServiceWorkerHost | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
}

function ask(
  worker: WorkerLike,
  message: WorkerRequest,
  idleMs: number,
  onProgress?: (progress: PrepareProgress) => void,
): Promise<EngineStatus[]> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (finish: () => void) => {
      clearTimeout(timer);
      channel.port1.close();
      finish();
    };
    const watchdog = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        settle(() => {
          reject(new Error('The service worker did not answer'));
        });
      }, idleMs);
    };

    channel.port1.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      watchdog();
      if (reply.type === 'progress') onProgress?.(reply.progress);
      else if (reply.type === 'status')
        settle(() => {
          resolve(reply.engines);
        });
      else
        settle(() => {
          reject(new Error(reply.message));
        });
    };
    watchdog();
    worker.postMessage(message, [channel.port2]);
  });
}

export function createEnginesClient(
  host: ServiceWorkerHost | undefined = browserHost(),
): EnginesClient {
  const activeWorker = async () => (await host?.getRegistration())?.active ?? undefined;

  return {
    async status() {
      const worker = await activeWorker();
      return worker ? ask(worker, { type: MESSAGE_ENGINES_STATUS }, STATUS_TIMEOUT_MS) : undefined;
    },
    async prepare(onProgress) {
      const worker = await activeWorker();
      if (!worker) throw new Error('There is no active service worker');
      return ask(worker, { type: MESSAGE_ENGINES_PREPARE }, PREPARE_IDLE_MS, onProgress);
    },
  };
}

export const enginesClient: EnginesClient = createEnginesClient();
