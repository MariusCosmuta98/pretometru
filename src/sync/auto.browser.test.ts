// @vitest-environment jsdom
// Dexie's live queries need the global IndexedDB, as in the product screens' tests.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecord, type PretometruDB } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { browserEnvironment } from './auto';
import { resetSyncServices, setSyncServices } from './services';
import { at } from './testing';

let db: PretometruDB;
let visibility: DocumentVisibilityState;

beforeEach(async () => {
  db = await createTestDb();
  setSyncServices({ getDb: () => Promise.resolve(db) });
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});
afterEach(() => {
  resetSyncServices();
  vi.useRealTimers();
});

const pause = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the browser environment of automatic sync', () => {
  it('tells when the device is back online, until it is stopped', () => {
    const callback = vi.fn();
    const stop = browserEnvironment().onOnline(callback);

    window.dispatchEvent(new Event('online'));
    expect(callback).toHaveBeenCalledTimes(1);

    stop();
    window.dispatchEvent(new Event('online'));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('tells when the user comes back to the app, not when the app is hidden', () => {
    const callback = vi.fn();
    const stop = browserEnvironment().onVisible(callback);

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(callback).not.toHaveBeenCalled();

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(callback).toHaveBeenCalledTimes(1);

    stop();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('tells when data changes on this device, not about the data that is already there', async () => {
    await createRecord(db.stores, { chain: 'lidl', name: 'Lidl' }, at('2026-11-05T10:00:00.000Z'));
    const callback = vi.fn();
    const stop = browserEnvironment().watchChanges(callback);
    await pause();
    expect(callback).not.toHaveBeenCalled();

    await createRecord(
      db.stores,
      { chain: 'metro', name: 'METRO' },
      at('2026-11-06T10:00:00.000Z'),
    );
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));

    stop();
    await createRecord(
      db.stores,
      { chain: 'unknown', name: 'Alt' },
      at('2026-11-07T10:00:00.000Z'),
    );
    await pause();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('runs and cancels timers', () => {
    vi.useFakeTimers();
    const environment = browserEnvironment();
    const ran = vi.fn();
    environment.setTimer(ran, 1000);
    environment.setTimer(ran, 1000)();

    vi.advanceTimersByTime(1000);

    expect(ran).toHaveBeenCalledTimes(1);
  });
});
