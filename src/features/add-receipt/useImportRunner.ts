import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  getImportServices,
  importToDraft,
  isImportError,
  type ImportErrorCode,
  type ImportInput,
  type ImportProgress,
} from '@/import';

export interface NamedInput {
  /** What the user sees: the file name, or "Text lipit". */
  label: string;
  input: ImportInput;
}

export interface ImportJob {
  id: number;
  label: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress?: ImportProgress;
  /** The draft saved for this input. */
  receiptId?: string;
  /** The database already has a receipt like this one. */
  duplicate?: boolean;
  error?: ImportErrorCode | 'UNKNOWN';
}

interface RunnerState {
  running: boolean;
  jobs: ImportJob[];
}

type RunnerAction =
  | { type: 'start'; jobs: ImportJob[] }
  | { type: 'update'; id: number; patch: Partial<ImportJob> }
  | { type: 'finish' };

function reduce(state: RunnerState, action: RunnerAction): RunnerState {
  switch (action.type) {
    case 'start':
      return { running: true, jobs: action.jobs };
    case 'update':
      return {
        ...state,
        jobs: state.jobs.map((job) => (job.id === action.id ? { ...job, ...action.patch } : job)),
      };
    case 'finish':
      return { ...state, running: false };
  }
}

/**
 * Runs imports one after the other (a phone should not OCR three photos at once), tracking each
 * one's progress and outcome. `cancel` stops the running import and skips the queued ones.
 */
export function useImportRunner() {
  const [state, dispatch] = useReducer(reduce, { running: false, jobs: [] });
  const controller = useRef<AbortController | undefined>(undefined);

  const start = useCallback(async (items: readonly NamedInput[]): Promise<ImportJob[]> => {
    const abort = new AbortController();
    controller.current = abort;
    const finished: ImportJob[] = items.map((item, id) => ({
      id,
      label: item.label,
      status: 'queued',
    }));
    dispatch({ type: 'start', jobs: finished.map((job) => ({ ...job })) });

    const services = getImportServices();
    for (const [id, item] of items.entries()) {
      const update = (patch: Partial<ImportJob>) => {
        finished[id] = { ...(finished[id] as ImportJob), ...patch };
        dispatch({ type: 'update', id, patch });
      };
      if (abort.signal.aborted) {
        update({ status: 'cancelled' });
        continue;
      }
      update({ status: 'running' });
      try {
        const outcome = await importToDraft(services, item.input, {
          signal: abort.signal,
          onProgress: (progress) => {
            dispatch({ type: 'update', id, patch: { progress } });
          },
        });
        update({
          status: 'done',
          receiptId: outcome.saved.receipt.id,
          duplicate: outcome.duplicates.length > 0,
        });
      } catch (error) {
        const code = isImportError(error) ? error.code : 'UNKNOWN';
        update({ status: code === 'CANCELLED' ? 'cancelled' : 'failed', error: code });
      }
    }
    dispatch({ type: 'finish' });
    controller.current = undefined;
    return finished;
  }, []);

  const cancel = useCallback(() => {
    controller.current?.abort();
  }, []);

  // Leaving the screen stops what is still being read: nobody is waiting for the result.
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  return { ...state, start, cancel };
}
