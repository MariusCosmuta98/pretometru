import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  browserStorageEnv,
  enginesClient,
  readOfflineReadiness,
  type EnginesClient,
  type OfflineReadiness,
  type StorageEnv,
} from '@/pwa';

type Subscribe = (onChange: () => void) => () => void;

/** What the section talks to. The defaults are the browser; tests provide fakes. */
export interface OfflineEnv {
  storage: StorageEnv;
  engines: EnginesClient;
  readiness: () => Promise<OfflineReadiness>;
  subscribeToController?: Subscribe;
}

export const OfflineEnvContext = createContext<OfflineEnv | undefined>(undefined);

const subscribeToController: Subscribe = (onChange) => {
  const worker = navigator.serviceWorker;
  worker?.addEventListener('controllerchange', onChange);
  return () => worker?.removeEventListener('controllerchange', onChange);
};

export function useOfflineEnv(): OfflineEnv {
  const provided = useContext(OfflineEnvContext);
  return useMemo(
    () =>
      provided ?? {
        storage: browserStorageEnv(),
        engines: enginesClient,
        readiness: () => readOfflineReadiness(),
        subscribeToController,
      },
    [provided],
  );
}

/**
 * Reads something asynchronously (`undefined` until it arrives or when it fails) and reads it again
 * on `refresh` or a change from `subscribe`. Both callbacks must keep their identity between renders.
 */
export function useRead<T>(
  read: () => Promise<T>,
  subscribe?: Subscribe,
): {
  value: T | undefined;
  refresh: () => void;
} {
  const [value, setValue] = useState<T>();
  const [round, setRound] = useState(0);

  useEffect(() => subscribe?.(() => setRound((previous) => previous + 1)), [subscribe]);

  useEffect(() => {
    let active = true;
    read().then(
      (next) => {
        if (active) setValue(next);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [read, round]);

  return { value, refresh: () => setRound((previous) => previous + 1) };
}
