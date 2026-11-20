import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { CacheStorageLike } from './cache-store';
import { discardSharedFiles, readSharedFiles, SHARE_PARAM } from './share-target';

const pageScope = () => new URL(import.meta.env.BASE_URL, window.location.href).href;
const pageCaches = (): CacheStorageLike | undefined =>
  typeof caches === 'undefined' ? undefined : caches;

// A batch is read once however often the screen mounts (React's StrictMode runs effects twice) and is
// handed over once, even if the URL is visited again.
const reading = new Map<string, Promise<File[]>>();
const delivered = new Set<string>();

function readOnce(id: string): Promise<File[]> {
  let files = reading.get(id);
  if (!files) {
    const store = pageCaches();
    files = store ? readSharedFiles(id, store, pageScope()).catch(() => []) : Promise.resolve([]);
    reading.set(id, files);
  }
  return files;
}

/**
 * Hands over the files that the Web Share Target left for this screen (`#/adauga?shared=<id>`, see
 * `share-target.ts`): `onFiles` is called once with them, then the batch is discarded and the
 * parameter leaves the address. `missing` is true when the batch is gone (expired, or nothing
 * arrived), so the screen can say so. Does nothing without the parameter.
 */
export function useSharedFiles(onFiles: (files: File[]) => void): { missing: boolean } {
  const [params, setParams] = useSearchParams();
  const id = params.get(SHARE_PARAM);
  const [missing, setMissing] = useState(false);
  const handler = useRef(onFiles);
  useEffect(() => {
    handler.current = onFiles;
  });

  useEffect(() => {
    if (!id || delivered.has(id)) return undefined;
    let active = true;
    void readOnce(id).then((files) => {
      if (!active || delivered.has(id)) return;
      delivered.add(id);
      const store = pageCaches();
      if (store) void discardSharedFiles(id, store, pageScope()).catch(() => undefined);
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.delete(SHARE_PARAM);
          return next;
        },
        { replace: true },
      );
      if (files.length === 0) setMissing(true);
      else handler.current(files);
    });
    return () => {
      active = false;
    };
  }, [id, setParams]);

  return { missing };
}
