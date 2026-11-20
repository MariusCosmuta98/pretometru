import type { EngineStatus, PrepareProgress } from './engine-cache';

/*
 * What the page and the service worker say to each other, besides the `SKIP_WAITING` message that
 * vite-plugin-pwa sends to apply an update. The page opens a `MessageChannel` per request and the
 * worker answers on the port it received.
 */

export const MESSAGE_ENGINES_STATUS = 'pretometru/engines-status';
export const MESSAGE_ENGINES_PREPARE = 'pretometru/engines-prepare';

export type WorkerRequest =
  { type: typeof MESSAGE_ENGINES_STATUS } | { type: typeof MESSAGE_ENGINES_PREPARE };

export type WorkerReply =
  | { type: 'status'; engines: EngineStatus[] }
  | { type: 'progress'; progress: PrepareProgress }
  | { type: 'error'; message: string };

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== 'object' || value === null) return false;
  const { type } = value as { type?: unknown };
  return type === MESSAGE_ENGINES_STATUS || type === MESSAGE_ENGINES_PREPARE;
}

export function isSkipWaiting(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'SKIP_WAITING'
  );
}
