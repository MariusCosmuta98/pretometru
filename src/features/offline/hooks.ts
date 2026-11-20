import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  browserStorageEnv,
  enginesClient,
  readOfflineReadiness,
  type EnginesClient,
  type OfflineReadiness,
  type StorageEnv,
} from '@/pwa';

/** What the section talks to. The defaults are the browser; tests provide fakes. */
export interface OfflineEnv {
  storage: StorageEnv;
  engines: EnginesClient;
  readiness: () => Promise<OfflineReadiness>;
}

export const OfflineEnvContext = createContext<OfflineEnv | undefined>(undefined);

export function useOfflineEnv(): OfflineEnv {
  const provided = useContext(OfflineEnvContext);
  return useMemo(
    () =>
      provided ?? {
        storage: browserStorageEnv(),
        engines: enginesClient,
        readiness: () => readOfflineReadiness(),
      },
    [provided],
  );
}

/**
 * Reads something asynchronously (`undefined` until it arrives or when it fails) and reads it again
 * on `refresh`. `read` must keep its identity between renders.
 */
export function useRead<T>(read: () => Promise<T>): {
  value: T | undefined;
  refresh: () => void;
} {
  const [value, setValue] = useState<T>();
  const [round, setRound] = useState(0);

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
