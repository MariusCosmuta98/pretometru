import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRecord, ensureSeed, type PretometruDB } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { startAutoSync, type AutoSync, type AutoSyncEnvironment } from './auto';
import { lockToken, saveConnection, setAutoSync, unlockToken } from './connection';
import { resetRunSync, runSync } from './run';
import { resetSyncRuntime } from './runtime';
import { getSyncServices, resetSyncServices, setSyncServices } from './services';
import { readStatus } from './status';
import {
  at,
  FULL_NAME,
  makeWorld,
  OWNER,
  REPO,
  seedSample,
  TOKEN,
  type MockGitHub,
} from './testing';

const MINUTE = 60_000;
const START = Date.parse('2026-11-20T12:00:00.000Z');

/** A clock, timers and triggers that a test moves by hand. */
function fakeEnvironment() {
  let time = START;
  const timers: Array<{ due: number; fn: () => void; live: boolean }> = [];
  const triggers = {
    visible: new Set<() => void>(),
    online: new Set<() => void>(),
    change: new Set<() => void>(),
  };
  const listen = (set: Set<() => void>) => (callback: () => void) => {
    set.add(callback);
    return () => {
      set.delete(callback);
    };
  };
  const environment: AutoSyncEnvironment = {
    now: () => time,
    setTimer: (fn, ms) => {
      const timer = { due: time + ms, fn, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    onVisible: listen(triggers.visible),
    onOnline: listen(triggers.online),
    watchChanges: listen(triggers.change),
  };
  const due = () => timers.filter((timer) => timer.live && timer.due <= time);

  return {
    environment,
    now: () => new Date(time),
    /** Moves the clock and runs the timers that fall due, earliest first. */
    advance(ms: number) {
      time += ms;
      for (let next = due()[0]; next; next = due()[0]) {
        next.live = false;
        next.fn();
      }
    },
    pending: () => timers.filter((timer) => timer.live).length,
    emit: (kind: keyof typeof triggers) => {
      for (const callback of [...triggers[kind]]) callback();
    },
    listeners: () => triggers.visible.size + triggers.online.size + triggers.change.size,
  };
}

let github: MockGitHub;
let db: PretometruDB;
let clock: ReturnType<typeof fakeEnvironment>;
let online: boolean;
let auto: AutoSync | undefined;

beforeEach(async () => {
  github = await makeWorld();
  db = await createTestDb();
  await ensureSeed(db);
  clock = fakeEnvironment();
  online = true;
  setSyncServices({
    getDb: () => Promise.resolve(db),
    fetch: github.fetch,
    now: clock.now,
    isOnline: () => online,
    sleep: () => Promise.resolve(),
    newDeviceId: () => 'DEV001',
    passphraseIterations: 1000,
  });
});
afterEach(async () => {
  auto?.stop();
  auto = undefined;
  github.dispose();
  await resetRunSync();
  resetSyncServices();
  lockToken();
  resetSyncRuntime();
  await db.delete();
  expect(github.violations).toEqual([]);
});

const connect = (passphrase?: string) =>
  saveConnection(db, { owner: OWNER, repo: REPO, token: TOKEN, passphrase }, getSyncServices());

function start(): AutoSync {
  auto = startAutoSync(clock.environment);
  return auto;
}

/** Moves the clock, then waits for the automatic attempts that it started. */
async function advance(ms: number) {
  clock.advance(ms);
  await auto?.idle();
}

/** How many syncs ran: each one starts by asking GitHub about the repository. */
const attempts = () =>
  github.requests.filter((request) => request.path === `/repos/${OWNER}/${REPO}`).length;

/** The app starts and the first automatic sync runs. */
async function startAndSync() {
  await connect();
  start();
  await advance(3_000);
  expect((await readStatus(db))?.ok).toBe(true);
}

describe('automatic sync', () => {
  it('does nothing until sync is set up, or when the user turned it off', async () => {
    start();
    await advance(10 * MINUTE);
    clock.emit('online');
    clock.emit('change');
    await advance(10 * MINUTE);
    expect(attempts()).toBe(0);

    await connect();
    await setAutoSync(db, false, getSyncServices());
    clock.emit('visible');
    await advance(10 * MINUTE);
    expect(attempts()).toBe(0);
  });

  it('syncs shortly after the app starts, not before', async () => {
    await connect();
    await seedSample(db);
    start();

    await advance(2_999);
    expect(attempts()).toBe(0);
    await advance(1);

    expect(attempts()).toBe(1);
    expect((await readStatus(db))?.ok).toBe(true);
    expect(github.files(FULL_NAME).has('data/products/2026-11.json')).toBe(true);
  });

  it('sends a burst of changes once, a little after the last of them', async () => {
    await startAndSync();

    for (const name of ['Kaufland', 'METRO', 'Lidl']) {
      await createRecord(db.stores, { chain: 'unknown', name }, at('2026-11-20T12:05:00.000Z'));
      clock.emit('change');
      await advance(10_000);
    }
    await advance(19_999);
    expect(attempts()).toBe(1);
    await advance(1);

    expect(attempts()).toBe(2);
    expect(github.files(FULL_NAME).get('data/stores/2026-11.json')).toContain('METRO');
    expect(github.history(FULL_NAME)).toHaveLength(3); // the README, the first sync, the burst
  });

  it('leaves a change alone when there is nothing new to send', async () => {
    await startAndSync();

    clock.emit('change'); // the merge of a sync moves the data too
    await advance(MINUTE);

    expect(attempts()).toBe(1);
  });

  it('syncs when the device is back online, and not while it is still offline', async () => {
    await startAndSync();
    await advance(MINUTE);

    online = false;
    clock.emit('online');
    await advance(0);
    expect(attempts()).toBe(1);

    online = true;
    clock.emit('online');
    await advance(0);
    expect(attempts()).toBe(2);
  });

  it('syncs when the user comes back to the app only if the last sync is not recent', async () => {
    await startAndSync();

    await advance(MINUTE);
    clock.emit('visible');
    await advance(0);
    expect(attempts()).toBe(1);

    await advance(5 * MINUTE);
    clock.emit('visible');
    await advance(0);
    expect(attempts()).toBe(2);
  });

  it('never starts two attempts closer together than the minimum gap', async () => {
    await startAndSync();

    clock.emit('online');
    await advance(0);
    expect(attempts()).toBe(1);

    await advance(10_000);
    expect(attempts()).toBe(2);
  });

  it('waits for the passphrase of a protected token, and goes on once it is entered', async () => {
    await connect('o parolă lungă');
    lockToken(); // the app was restarted
    start();
    await advance(3_000);
    expect(attempts()).toBe(0);

    await unlockToken(db, 'o parolă lungă');
    clock.emit('online');
    await advance(0);
    expect(attempts()).toBe(1);
  });

  it('stops after an error that retrying cannot fix, until a manual sync works', async () => {
    await connect();
    github.revoke(TOKEN);
    start();
    await advance(3_000);
    expect((await readStatus(db))?.error?.code).toBe('BAD_TOKEN');
    expect(attempts()).toBe(1);

    await advance(20 * MINUTE);
    clock.emit('visible');
    clock.emit('online');
    await advance(0);
    expect(attempts()).toBe(1);

    // The user makes a new token and syncs by hand.
    github.addToken('second-fake-token', OWNER, { [FULL_NAME]: 'write' });
    await saveConnection(
      db,
      { owner: OWNER, repo: REPO, token: 'second-fake-token' },
      getSyncServices(),
    );
    await runSync();
    expect(attempts()).toBe(2);

    await advance(20 * MINUTE);
    clock.emit('visible');
    await advance(0);
    expect(attempts()).toBe(3);
  });

  it('waits for the time GitHub gave after a rate limit', async () => {
    await connect();
    github.failNext(/./, {
      status: 403,
      headers: { 'retry-after': '600' },
      body: { message: 'You have exceeded a secondary rate limit.' },
    });
    start();
    await advance(3_000);
    expect((await readStatus(db))?.error?.code).toBe('RATE_LIMITED');

    await advance(5 * MINUTE);
    clock.emit('online');
    await advance(0);
    expect(attempts()).toBe(1);

    await advance(5 * MINUTE + 1);
    clock.emit('online');
    await advance(0);
    expect(attempts()).toBe(2);
  });

  it('can be stopped, and then leaves no timer and no listener behind', async () => {
    await connect();
    start();
    expect(clock.listeners()).toBe(3);

    auto?.stop();

    expect(clock.listeners()).toBe(0);
    expect(clock.pending()).toBe(0);
    await advance(10 * MINUTE);
    expect(attempts()).toBe(0);
  });
});
