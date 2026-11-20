/**
 * Test-only helpers for the sync: worlds (an in-memory GitHub with a user, a token and a private
 * repository), devices (a database of their own that syncs with it) and sample data. The GitHub
 * itself is `./mock-github`. Everything here is fake: never use a real token. Never import this
 * from application code.
 */
import { createIdGenerator } from '@/domain';
import {
  createRecord,
  ensureSeed,
  saveReceipt,
  setSetting,
  type PretometruDB,
  type StorageContext,
} from '@/storage';
import { createTestDb } from '@/storage/testing';
import { syncNow, type SyncOptions, type SyncResult } from './engine';
import { createGitHubClient } from './github';
import { MockGitHub, type Permission } from './mock-github';

export { MockGitHub } from './mock-github';
export type {
  MockCommit,
  MockReply,
  MockRepoOptions,
  MockRequest,
  Permission,
} from './mock-github';

/** Obviously fake, and not shaped like a real token (the leak check would rightly object). */
export const TOKEN = 'fake-token-for-tests';
export const OWNER = 'ana';
export const REPO = 'pretometru-data';
export const FULL_NAME = `${OWNER}/${REPO}`;

/** A GitHub with one user, `ana`, whose token may write to the private repository `ana/pretometru-data`. */
export async function makeWorld(
  options: { readme?: boolean; private?: boolean; permission?: Permission } = {},
): Promise<MockGitHub> {
  const github = new MockGitHub().addToken(TOKEN, OWNER, {
    [FULL_NAME]: options.permission ?? 'write',
  });
  await github.addRepo({
    owner: OWNER,
    name: REPO,
    readme: options.readme ?? true,
    private: options.private ?? true,
  });
  return github;
}

let sequence = 0;

/**
 * A storage context at an instant: records written with it get that `updatedAt` and ids created
 * at that time (so their month is known), in increasing order.
 */
export function at(iso: string): StorageContext {
  const time = Date.parse(iso);
  const newId = createIdGenerator({
    now: () => time,
    randomBytes: (length) => {
      const bytes = new Uint8Array(length);
      new DataView(bytes.buffer).setUint32(length - 4, (sequence += 1));
      return bytes;
    },
  });
  return { now: () => new Date(time), newId };
}

export interface Device {
  /** Shows up in the commit messages. */
  label: string;
  db: PretometruDB;
  sync: (overrides?: Partial<SyncOptions>) => Promise<SyncResult>;
}

/** A device: a database of its own (with the built-in categories, as the app opens it) that syncs as `ana`. */
export async function makeDevice(
  github: MockGitHub,
  label: string,
  options: { token?: string; isOnline?: () => boolean } = {},
): Promise<Device> {
  const db = await createTestDb();
  await ensureSeed(db);
  const clock = () => new Date('2026-11-20T12:00:00.000Z');
  return {
    label,
    db,
    sync: (overrides = {}) =>
      syncNow({
        db,
        repo: createGitHubClient({
          token: options.token ?? TOKEN,
          fetch: github.fetch,
          now: clock,
          ...(options.isOnline ? { isOnline: options.isOnline } : {}),
        }).repo(OWNER, REPO),
        deviceId: label,
        now: clock,
        sleep: () => Promise.resolve(),
        ...overrides,
      }),
  };
}

/** A store, a product, a receipt with two lines, a list with an item and a setting, all written at `iso`. */
export async function seedSample(db: PretometruDB, iso = '2026-11-05T10:00:00.000Z') {
  const context = at(iso);
  const store = await createRecord(db.stores, { chain: 'lidl', name: 'Lidl Cluj' }, context);
  const category = await createRecord(
    db.categories,
    { name: 'Cafea', color: '#8b4513', icon: '☕', order: 5 },
    context,
  );
  const product = await createRecord(
    db.products,
    { name: 'Cafea 250g', categoryId: category.id, baseUnit: 'kg' },
    context,
  );
  const saved = await saveReceipt(
    db,
    {
      storeId: store.id,
      purchasedAt: '2026-11-05T09:30',
      docType: 'receipt',
      totalBani: 3000,
      source: { kind: 'manual' },
      extraction: { engine: 'manual', parser: 'manual', version: '1.0.0', warnings: [] },
      status: 'confirmed',
    },
    [
      {
        idx: 0,
        rawName: 'CAFEA 250G',
        qty: 1,
        unit: 'buc',
        lineTotalBani: 2000,
        discountBani: 0,
        kind: 'product',
        productId: product.id,
        packQty: 250,
        packUnit: 'g',
      },
      {
        idx: 1,
        rawName: 'PAINE',
        qty: 1,
        unit: 'buc',
        lineTotalBani: 1000,
        discountBani: 0,
        kind: 'product',
      },
    ],
    context,
  );
  const list = await createRecord(db.lists, { name: 'Weekend' }, context);
  await createRecord(
    db.listItems,
    { listId: list.id, productId: product.id, label: 'Cafea', checked: false, order: 0 },
    context,
  );
  await setSetting(db, 'priceWindowDays', 60, context);
  return { store, category, product, receipt: saved.receipt, lines: saved.lines, list };
}
