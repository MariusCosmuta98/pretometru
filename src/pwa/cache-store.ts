/*
 * The parts of the Cache API that the offline code uses, so that it runs against the real
 * `caches` in the browser and against an in-memory fake under Node (`testing.ts`).
 */

export interface CacheLike {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  keys(): Promise<ReadonlyArray<{ url: string }>>;
  delete(url: string): Promise<boolean>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  has(name: string): Promise<boolean>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}
