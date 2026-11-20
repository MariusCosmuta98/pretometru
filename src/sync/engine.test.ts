import { afterEach, describe, expect, it } from 'vitest';
import type { BackupData, Line, Receipt } from '@/domain';
import {
  createRecord,
  exportBackup,
  getReceiptWithLines,
  listActive,
  saveReceipt,
  setKeyValue,
  setSetting,
  softDelete,
  updateRecord,
  type LineInput,
  type PretometruDB,
  type ReceiptInput,
} from '@/storage';
import { makeProduct } from '@/domain/testing';
import { README_TEXT, SYNC_FORMAT_VERSION } from './layout';
import {
  at,
  FULL_NAME,
  makeDevice,
  makeWorld,
  seedSample,
  TOKEN,
  type Device,
  type MockGitHub,
} from './testing';

const T1 = '2026-11-06T10:00:00.000Z';
const T2 = '2026-11-07T10:00:00.000Z';
const T3 = '2026-11-08T10:00:00.000Z';

const snapshot = async (db: PretometruDB): Promise<BackupData> =>
  (await exportBackup(db)).backup.data;
const countOf = (data: BackupData): number =>
  Object.values(data).reduce((sum, rows) => sum + rows.length, 0);
const SEED_CATEGORIES = 16;

const recordsOf = (text: string | undefined) =>
  (JSON.parse(text ?? '{"records":[]}') as { records: Array<Record<string, unknown>> }).records;

let github: MockGitHub;

afterEach(() => {
  // Nothing the sync sent may be something a browser would have blocked.
  expect(github.violations).toEqual([]);
});

async function twoDevices(): Promise<{ phone: Device; tablet: Device }> {
  github = await makeWorld();
  return { phone: await makeDevice(github, 'PHONE1'), tablet: await makeDevice(github, 'TABLET') };
}

describe('the first sync', () => {
  it('uploads everything to a repository without data, in one commit', async () => {
    const { phone } = await twoDevices();
    const { receipt } = await seedSample(phone.db);
    const total = countOf(await snapshot(phone.db));

    const result = await phone.sync();

    expect(result).toMatchObject({ firstSync: true, pulled: 0, pushed: total, attempts: 1 });
    const history = github.history(FULL_NAME);
    expect(history.map((commit) => commit.message)).toEqual([
      `Prima sincronizare Pretometru (dispozitiv PHONE1): ${total} înregistrări`,
      'Initial commit',
    ]);
    expect(history[0]?.sha).toBe(result.commit);

    const files = github.files(FULL_NAME);
    expect([...files.keys()]).toEqual([
      'README.md',
      'data/categories/2026-11.json',
      'data/categories/seed.json',
      'data/lines/2026-11.json',
      'data/listItems/2026-11.json',
      'data/lists/2026-11.json',
      'data/pretometru.json',
      'data/products/2026-11.json',
      'data/receipts/2026-11.json',
      'data/settings.json',
      'data/stores/2026-11.json',
    ]);
    expect(JSON.parse(files.get('data/pretometru.json') ?? '')).toEqual({
      format: 'pretometru-data',
      formatVersion: SYNC_FORMAT_VERSION,
    });
    expect(recordsOf(files.get('data/receipts/2026-11.json')).map((r) => r.id)).toEqual([
      receipt.id,
    ]);
    expect(recordsOf(files.get('data/categories/seed.json'))).toHaveLength(SEED_CATEGORIES);
  });

  it('keeps one record per line, so that Git shows exactly the records that changed', async () => {
    const { phone } = await twoDevices();
    await seedSample(phone.db);
    await phone.sync();

    const lines = (github.files(FULL_NAME).get('data/lines/2026-11.json') ?? '').split('\n');
    expect(lines[0]).toBe('{');
    expect(lines[1]).toBe('  "records": [');
    expect(lines.slice(2, 4).every((line) => line.startsWith('    {"id":"'))).toBe(true);
    expect(lines[2]?.endsWith('},')).toBe(true);
    expect(lines[3]?.endsWith('}')).toBe(true);
  });

  it('has nothing to do the second time: no commit, no write', async () => {
    const { phone } = await twoDevices();
    await seedSample(phone.db);
    await phone.sync();
    const commits = github.history(FULL_NAME).length;
    const writes = github.writes.length;

    const again = await phone.sync();

    expect(again).toMatchObject({ firstSync: false, pulled: 0, pushed: 0, commit: undefined });
    expect(github.history(FULL_NAME)).toHaveLength(commits);
    expect(github.writes).toHaveLength(writes);
  });

  it('initialises a repository that has no commit yet, with a README', async () => {
    github = await makeWorld({ readme: false });
    const phone = await makeDevice(github, 'PHONE1');
    await seedSample(phone.db);

    await phone.sync();

    expect(github.history(FULL_NAME).map((commit) => commit.message)).toEqual([
      expect.stringContaining('Prima sincronizare') as string,
      'Inițializare depozit Pretometru',
    ]);
    expect(github.files(FULL_NAME).get('README.md')).toBe(README_TEXT);
  });

  it('syncs a device with no data of its own: only the built-in categories go up', async () => {
    const { phone } = await twoDevices();
    const result = await phone.sync();
    expect(result.pushed).toBe(SEED_CATEGORIES);
  });
});

describe('pull and merge', () => {
  it('gives a second device everything the first one uploaded', async () => {
    const { phone, tablet } = await twoDevices();
    await seedSample(phone.db);
    await phone.sync();
    const commits = github.history(FULL_NAME).length;

    const result = await tablet.sync();

    expect(result).toMatchObject({ firstSync: false, pushed: 0, commit: undefined });
    const expected = await snapshot(phone.db);
    expect(result.pulled).toBe(countOf(expected) - SEED_CATEGORIES);
    expect(await snapshot(tablet.db)).toEqual(expected);
    expect(github.history(FULL_NAME)).toHaveLength(commits);
  });

  it('merges what each device did into one dataset on both', async () => {
    const { phone, tablet } = await twoDevices();
    await seedSample(phone.db);
    await phone.sync();
    await tablet.sync();

    await createRecord(phone.db.stores, { chain: 'kaufland', name: 'Kaufland Iași' }, at(T1));
    await createRecord(tablet.db.stores, { chain: 'metro', name: 'METRO Cluj' }, at(T2));
    await phone.sync();
    await tablet.sync();
    await phone.sync();

    const names = async (db: PretometruDB) =>
      (await listActive(db.stores)).map((store) => store.name).sort();
    expect(await names(phone.db)).toEqual(['Kaufland Iași', 'Lidl Cluj', 'METRO Cluj']);
    expect(await snapshot(tablet.db)).toEqual(await snapshot(phone.db));
    expect(
      github
        .files(FULL_NAME)
        .get('data/stores/2026-11.json')
        ?.match(/"name":/g),
    ).toHaveLength(3);
  });

  it('carries the portable settings, and only those', async () => {
    const { phone, tablet } = await twoDevices();
    await setSetting(phone.db, 'priceWindowDays', 30, at(T1));
    await setKeyValue(phone.db.settings, 'geminiApiKey', 'secret-api-key-sentinel', at(T1));
    await phone.sync();
    // A key somebody planted in the repository is not imported either.
    const settings = github.files(FULL_NAME).get('data/settings.json') ?? '';
    await github.push(FULL_NAME, {
      'data/settings.json': settings.replace(
        '\n  ]',
        `,\n    {"key":"planted","value":"x","updatedAt":"${T3}"}\n  ]`,
      ),
    });

    await tablet.sync();

    expect(await tablet.db.settings.get('priceWindowDays')).toMatchObject({ value: 30 });
    expect(await tablet.db.settings.get('geminiApiKey')).toBeUndefined();
    expect(await tablet.db.settings.get('planted')).toBeUndefined();
    const everything = [...github.files(FULL_NAME).values()].join('\n');
    expect(everything).not.toContain('secret-api-key-sentinel');
    expect(everything).toContain('"planted"');
  });
});

describe('last write wins, per record', () => {
  it('keeps the later edit whichever device syncs last', async () => {
    const { phone, tablet } = await twoDevices();
    const { product } = await seedSample(phone.db);
    await phone.sync();
    await tablet.sync();

    await updateRecord(phone.db.products, product.id, { name: 'Cafea A' }, at(T1));
    await updateRecord(tablet.db.products, product.id, { name: 'Cafea B' }, at(T2));
    await tablet.sync(); // the later edit goes up first
    await phone.sync(); // the earlier one must neither win nor go up
    await tablet.sync();

    for (const device of [phone, tablet]) {
      expect((await device.db.products.get(product.id))?.name, device.label).toBe('Cafea B');
    }
    expect(github.files(FULL_NAME).get('data/products/2026-11.json')).toContain('Cafea B');
    expect(github.files(FULL_NAME).get('data/products/2026-11.json')).not.toContain('Cafea A');
  });

  it('lets the later edit win even when it is pushed first by the other device', async () => {
    const { phone, tablet } = await twoDevices();
    const { product } = await seedSample(phone.db);
    await phone.sync();
    await tablet.sync();

    await updateRecord(tablet.db.products, product.id, { name: 'Cafea B' }, at(T2));
    await tablet.sync();
    await updateRecord(phone.db.products, product.id, { name: 'Cafea A' }, at(T1));
    const result = await phone.sync();

    expect((await phone.db.products.get(product.id))?.name).toBe('Cafea B');
    expect(result).toMatchObject({ pulled: 1, pushed: 0, commit: undefined });
  });

  it('never makes two devices overwrite each other over a tie', async () => {
    const { phone, tablet } = await twoDevices();
    const { product } = await seedSample(phone.db);
    await phone.sync();
    await tablet.sync();
    // The same instant on both devices, different content: the one case a timestamp cannot decide.
    await phone.db.products.put({ ...product, name: 'Cafea A', updatedAt: T1 });
    await tablet.db.products.put({ ...product, name: 'Cafea B', updatedAt: T1 });

    await phone.sync();
    const commits = github.history(FULL_NAME).length;
    await tablet.sync();
    await phone.sync();
    await tablet.sync();

    // The repository kept the first copy and nobody pushed over it.
    expect(github.history(FULL_NAME)).toHaveLength(commits);
    expect(github.files(FULL_NAME).get('data/products/2026-11.json')).toContain('Cafea A');
    // A real edit afterwards settles it everywhere.
    await updateRecord(tablet.db.products, product.id, { name: 'Cafea C' }, at(T2));
    await tablet.sync();
    await phone.sync();
    expect((await phone.db.products.get(product.id))?.name).toBe('Cafea C');
  });
});

describe('tombstones', () => {
  it('delete a record on every device, and stay deleted', async () => {
    const { phone, tablet } = await twoDevices();
    const { product } = await seedSample(phone.db);
    await phone.sync();
    await tablet.sync();

    await softDelete(phone.db.products, product.id, at(T1));
    await phone.sync();
    await tablet.sync();

    expect(await listActive(tablet.db.products)).toEqual([]);
    expect((await tablet.db.products.get(product.id))?.deletedAt).toBeDefined();
    expect(github.files(FULL_NAME).get('data/products/2026-11.json')).toContain('"deletedAt"');

    // Syncing again, from either side, does not bring it back.
    await tablet.sync();
    await phone.sync();
    expect(await listActive(phone.db.products)).toEqual([]);
    expect(await listActive(tablet.db.products)).toEqual([]);
  });

  it('lose against an edit made after the deletion', async () => {
    const { phone, tablet } = await twoDevices();
    const { product } = await seedSample(phone.db);
    await phone.sync();
    await tablet.sync();

    await softDelete(phone.db.products, product.id, at(T1));
    await updateRecord(tablet.db.products, product.id, { name: 'Cafea revenită' }, at(T2));
    await phone.sync();
    await tablet.sync();
    await phone.sync();

    for (const device of [phone, tablet]) {
      expect(
        (await listActive(device.db.products)).map((p) => p.name),
        device.label,
      ).toEqual(['Cafea revenită']);
    }
  });

  it('win against an edit made before the deletion', async () => {
    const { phone, tablet } = await twoDevices();
    const { product } = await seedSample(phone.db);
    await phone.sync();
    await tablet.sync();

    await updateRecord(tablet.db.products, product.id, { name: 'Prea târziu' }, at(T1));
    await softDelete(phone.db.products, product.id, at(T2));
    await tablet.sync();
    await phone.sync();
    await tablet.sync();

    expect(await listActive(phone.db.products)).toEqual([]);
    expect(await listActive(tablet.db.products)).toEqual([]);
  });

  it('delete a receipt together with its lines', async () => {
    const { phone, tablet } = await twoDevices();
    const { receipt } = await seedSample(phone.db);
    await phone.sync();
    await tablet.sync();

    const { deleteReceipt } = await import('@/storage');
    await deleteReceipt(phone.db, receipt.id, at(T1));
    await phone.sync();
    await tablet.sync();

    expect(await getReceiptWithLines(tablet.db, receipt.id)).toBeUndefined();
    expect(await listActive(tablet.db.lines)).toEqual([]);
  });
});

describe('the lines of a receipt', () => {
  const asReceiptInput = (receipt: Receipt): ReceiptInput => {
    const { updatedAt, deletedAt, linesUpdatedAt, ...rest } = receipt;
    void [updatedAt, deletedAt, linesUpdatedAt];
    return rest;
  };
  const asLineInput = (line: Line): LineInput => {
    const {
      updatedAt,
      deletedAt,
      receiptId,
      paidUnitBani,
      baseUnit,
      pricePerBaseMilliBani,
      ...rest
    } = line;
    void [updatedAt, deletedAt, receiptId, paidUnitBani, baseUnit, pricePerBaseMilliBani];
    return rest;
  };

  it('stay one set when two devices re-save the same receipt with different lines', async () => {
    const { phone, tablet } = await twoDevices();
    const { receipt, lines } = await seedSample(phone.db);
    await phone.sync();
    await tablet.sync();
    const input = asReceiptInput(receipt);
    const [coffee, bread] = lines.map(asLineInput) as [LineInput, LineInput];

    const { id: _breadId, ...breadFields } = bread;
    const tea: LineInput = { ...breadFields, rawName: 'CEAI' };

    // The phone swaps the bread for tea (Nov 6); the tablet keeps both lines (Nov 7, later).
    await saveReceipt(phone.db, input, [coffee, tea], at(T1));
    await saveReceipt(tablet.db, input, [coffee, bread], at(T2));

    await phone.sync();
    await tablet.sync();
    await phone.sync();
    await tablet.sync();

    for (const device of [phone, tablet]) {
      const view = await getReceiptWithLines(device.db, receipt.id);
      expect(
        view?.lines.map((line) => line.rawName),
        device.label,
      ).toEqual(['CAFEA 250G', 'PAINE']);
      expect(view?.lines.reduce((sum, line) => sum + line.lineTotalBani, 0)).toBe(
        view?.receipt.totalBani,
      );
    }
    expect(await snapshot(tablet.db)).toEqual(await snapshot(phone.db));
  });

  it('are reconciled on the device that pulls them, before anything is pushed back', async () => {
    const { phone, tablet } = await twoDevices();
    const { receipt, lines } = await seedSample(phone.db);
    await phone.sync();
    await tablet.sync();
    const input = asReceiptInput(receipt);
    const [coffee, bread] = lines.map(asLineInput) as [LineInput, LineInput];

    // The tablet re-saved the receipt later with fewer lines; the phone adds a line meanwhile.
    const { id: _breadId, ...breadFields } = bread;
    const tea: LineInput = { ...breadFields, rawName: 'CEAI' };
    await saveReceipt(tablet.db, input, [coffee], at(T2));
    await saveReceipt(phone.db, input, [coffee, bread, tea], at(T1));
    await phone.sync();
    await tablet.sync();

    // The stale lines arrive on the tablet and are tombstoned there, with the same cutoff everywhere.
    const view = await getReceiptWithLines(tablet.db, receipt.id);
    expect(view?.lines.map((line) => line.rawName)).toEqual(['CAFEA 250G']);
    await phone.sync();
    expect((await getReceiptWithLines(phone.db, receipt.id))?.lines.map((l) => l.rawName)).toEqual([
      'CAFEA 250G',
    ]);
  });
});

describe('a branch that moves during the sync', () => {
  it('is rejected, fetched again, merged again and pushed', async () => {
    const { phone, tablet } = await twoDevices();
    await seedSample(phone.db);
    await phone.sync();
    await tablet.sync();
    await createRecord(phone.db.stores, { chain: 'kaufland', name: 'De pe telefon' }, at(T1));
    await createRecord(tablet.db.stores, { chain: 'metro', name: 'De pe tabletă' }, at(T2));
    // The tablet syncs between the phone's tree and its ref update.
    github.before(/^PATCH .*\/git\/refs\//, async () => {
      await tablet.sync();
    });
    const delays: number[] = [];

    const result = await phone.sync({
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    expect(result.attempts).toBe(2);
    expect(delays).toHaveLength(1);
    expect(result.pulled).toBe(1);
    const names = (await listActive(phone.db.stores)).map((store) => store.name).sort();
    expect(names).toEqual(['De pe tabletă', 'De pe telefon', 'Lidl Cluj']);
    // A straight line of commits: nothing was overwritten or lost.
    const messages = github.history(FULL_NAME).map((commit) => commit.message);
    expect(messages.slice(0, 2).map((m) => m.match(/dispozitiv (\w+)/)?.[1])).toEqual([
      'PHONE1',
      'TABLET',
    ]);
    await tablet.sync();
    expect(await snapshot(tablet.db)).toEqual(await snapshot(phone.db));
  });

  it('gives up after four rounds without changing anything', async () => {
    const { phone } = await twoDevices();
    await seedSample(phone.db);
    await phone.sync();
    await createRecord(phone.db.stores, { chain: 'kaufland', name: 'Nou' }, at(T1));
    let pushes = 0;
    github.before(
      /^PATCH .*\/git\/refs\//,
      async () => {
        pushes += 1;
        await github.push(FULL_NAME, { 'notes.txt': `change ${pushes}` });
      },
      10,
    );
    const delays: number[] = [];

    await expect(
      phone.sync({
        sleep: (ms) => {
          delays.push(ms);
          return Promise.resolve();
        },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(pushes).toBe(4);
    expect(delays).toHaveLength(3);
    expect(github.files(FULL_NAME).get('data/stores/2026-11.json')).not.toContain('Nou');
  });
});

describe('the repository must be private', () => {
  it('refuses a public repository before reading or writing anything else', async () => {
    github = await makeWorld({ private: false });
    const phone = await makeDevice(github, 'PHONE1');
    await seedSample(phone.db);

    await expect(phone.sync()).rejects.toMatchObject({ code: 'REPO_NOT_PRIVATE' });

    expect(github.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /repos/ana/pretometru-data',
    ]);
    expect(github.writes).toEqual([]);
  });

  it('checks again on every sync: a repository made public later is refused', async () => {
    const { phone } = await twoDevices();
    await seedSample(phone.db);
    await phone.sync();
    const writes = github.writes.length;

    github.setPrivate(FULL_NAME, false);
    await createRecord(phone.db.stores, { chain: 'kaufland', name: 'Nou' }, at(T1));
    await expect(phone.sync()).rejects.toMatchObject({ code: 'REPO_NOT_PRIVATE' });
    expect(github.writes).toHaveLength(writes);

    github.setPrivate(FULL_NAME, true);
    await expect(phone.sync()).resolves.toMatchObject({ pushed: 1 });
  });

  it('refuses an archived repository', async () => {
    const { phone } = await twoDevices();
    github.setArchived(FULL_NAME, true);
    await expect(phone.sync()).rejects.toMatchObject({ code: 'REPO_ARCHIVED' });
    expect(github.writes).toEqual([]);
  });
});

describe('token and permissions', () => {
  it('reports a token GitHub does not know, or that was revoked', async () => {
    const { phone } = await twoDevices();
    const stranger = await makeDevice(github, 'X', { token: 'not-a-known-token' });
    await expect(stranger.sync()).rejects.toMatchObject({ code: 'BAD_TOKEN', status: 401 });

    github.revoke(TOKEN);
    await expect(phone.sync()).rejects.toMatchObject({ code: 'BAD_TOKEN' });
  });

  it('reports a repository the token does not include', async () => {
    github = await makeWorld();
    github.addToken('other-token', 'bob');
    const phone = await makeDevice(github, 'X', { token: 'other-token' });
    await expect(phone.sync()).rejects.toMatchObject({ code: 'NO_ACCESS' });
  });

  it('stops at the first write when the token may only read, leaving the repository as it was', async () => {
    github = await makeWorld({ permission: 'read' });
    const phone = await makeDevice(github, 'PHONE1');
    await seedSample(phone.db);

    await expect(phone.sync()).rejects.toMatchObject({ code: 'NO_PERMISSION', status: 403 });

    expect(github.history(FULL_NAME)).toHaveLength(1);
    expect(github.writes.every((request) => request.status === 403)).toBe(true);
  });

  it('reports a token without access to the contents', async () => {
    github = await makeWorld({ permission: 'metadata' });
    const phone = await makeDevice(github, 'PHONE1');
    await expect(phone.sync()).rejects.toMatchObject({ code: 'NO_PERMISSION' });
  });

  it('reports a repository that rejects direct pushes', async () => {
    const { phone } = await twoDevices();
    await seedSample(phone.db);
    github.failNext(/^PATCH /, {
      status: 422,
      body: { message: 'Protected branch update failed for refs/heads/main.' },
    });
    await expect(phone.sync()).rejects.toMatchObject({ code: 'BRANCH_PROTECTED' });
  });

  it('never puts the token, or anything outside the data, into the repository', async () => {
    const { phone } = await twoDevices();
    await seedSample(phone.db);
    await setKeyValue(phone.db.syncState, 'sync.token', { kind: 'plain', token: TOKEN });
    await setKeyValue(phone.db.settings, 'geminiApiKey', 'sentinel-api-key');
    await phone.sync();

    const everything = [...github.files(FULL_NAME).values()].join('\n');
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain('sentinel-api-key');
    expect(JSON.stringify((await exportBackup(phone.db)).backup)).not.toContain(TOKEN);
    expect(JSON.stringify(github.requests.map((request) => request.body))).not.toContain(TOKEN);
  });
});

describe('rate limits and connectivity', () => {
  it('reports the primary rate limit with the time it resets', async () => {
    const { phone } = await twoDevices();
    const reset = Date.parse('2026-11-20T12:30:00.000Z') / 1000;
    github.failNext(/./, {
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
      body: { message: 'API rate limit exceeded for user ID 1.' },
    });

    await expect(phone.sync()).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAt: new Date('2026-11-20T12:30:00.000Z'),
    });
  });

  it('reports a secondary rate limit with its Retry-After', async () => {
    const { phone } = await twoDevices();
    github.failNext(/./, {
      status: 403,
      headers: { 'retry-after': '90' },
      body: { message: 'You have exceeded a secondary rate limit.' },
    });

    await expect(phone.sync()).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAt: new Date('2026-11-20T12:01:30.000Z'),
    });
  });

  it('reports a 429 and server errors', async () => {
    const { phone } = await twoDevices();
    github.failNext(/./, { status: 429, body: { message: 'Too Many Requests' } });
    await expect(phone.sync()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    github.failNext(/./, { status: 503, body: { message: 'Service Unavailable' } });
    await expect(phone.sync()).rejects.toMatchObject({ code: 'SERVER', status: 503 });
  });

  it('keeps what it pulled when it is stopped later, and finishes on the next try', async () => {
    const { phone, tablet } = await twoDevices();
    const { product } = await seedSample(phone.db);
    await phone.sync();
    await createRecord(tablet.db.stores, { chain: 'metro', name: 'METRO Cluj' }, at(T2));
    github.failNext(/^POST .*\/git\/blobs$/, {
      status: 403,
      headers: { 'retry-after': '60' },
      body: { message: 'You have exceeded a secondary rate limit.' },
    });

    await expect(tablet.sync()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(await tablet.db.products.get(product.id)).toBeDefined();
    expect(github.files(FULL_NAME).get('data/stores/2026-11.json')).not.toContain('METRO');

    const result = await tablet.sync();
    expect(result).toMatchObject({ pulled: 0, pushed: 1 });
    expect(github.files(FULL_NAME).get('data/stores/2026-11.json')).toContain('METRO Cluj');
  });

  it('fails fast, without a request, when the device is offline', async () => {
    github = await makeWorld();
    const phone = await makeDevice(github, 'PHONE1', { isOnline: () => false });
    await expect(phone.sync()).rejects.toMatchObject({ code: 'OFFLINE' });
    expect(github.requests).toEqual([]);
  });

  it('tells a dead network from an offline device', async () => {
    let online = true;
    github = await makeWorld();
    const phone = await makeDevice(github, 'PHONE1', { isOnline: () => online });

    github.setOffline(true);
    await expect(phone.sync()).rejects.toMatchObject({ code: 'NETWORK' });
    online = false; // the browser notices a moment later
    await expect(phone.sync()).rejects.toMatchObject({ code: 'OFFLINE' });
    github.setOffline(false);
    online = true;
    await expect(phone.sync()).resolves.toMatchObject({ firstSync: true });
  });
});

describe('a repository this version must not touch', () => {
  async function syncedPair() {
    const { phone, tablet } = await twoDevices();
    await seedSample(phone.db);
    await phone.sync();
    return { phone, tablet };
  }

  it('is left alone when a data file cannot be read, and so is this device', async () => {
    const { tablet } = await syncedPair();
    await createRecord(tablet.db.stores, { chain: 'metro', name: 'METRO Cluj' }, at(T2));
    const before = await snapshot(tablet.db);
    await github.push(FULL_NAME, { 'data/stores/2026-11.json': '{ this is not json' });
    const writes = github.writes.length;
    const head = github.head(FULL_NAME);

    await expect(tablet.sync()).rejects.toMatchObject({
      code: 'REMOTE_INVALID',
      detail: 'data/stores/2026-11.json',
    });

    expect(github.writes).toHaveLength(writes);
    expect(github.head(FULL_NAME)).toBe(head);
    expect(await snapshot(tablet.db)).toEqual(before);
  });

  it('is left alone when a record breaks its contract', async () => {
    const { tablet } = await syncedPair();
    await github.push(FULL_NAME, {
      'data/products/2026-11.json': `{"records":[${JSON.stringify({ ...makeProduct(), baseUnit: 'rolă' })}]}`,
    });
    await expect(tablet.sync()).rejects.toMatchObject({
      code: 'REMOTE_INVALID',
      detail: expect.stringContaining('baseUnit') as string,
    });
    expect(await tablet.db.products.count()).toBe(0);
  });

  it('is left alone when a newer version of the app wrote it', async () => {
    const { tablet } = await syncedPair();
    await github.push(FULL_NAME, {
      'data/pretometru.json': JSON.stringify({ format: 'pretometru-data', formatVersion: 2 }),
    });
    const writes = github.writes.length;
    await expect(tablet.sync()).rejects.toMatchObject({ code: 'REMOTE_NEWER' });
    expect(github.writes).toHaveLength(writes);
  });

  it('is left alone when it is too large to list', async () => {
    const { tablet } = await syncedPair();
    github.limitTrees(2);
    await expect(tablet.sync()).rejects.toMatchObject({ code: 'REMOTE_TOO_LARGE' });
  });

  it('keeps every file that is not one of ours', async () => {
    const { phone, tablet } = await syncedPair();
    await github.push(FULL_NAME, {
      'notes.txt': 'my notes',
      'data/other/2026-11.json': '{"not":"ours"}',
      'data/lines/readme.md': 'hello',
    });
    await createRecord(tablet.db.stores, { chain: 'metro', name: 'METRO Cluj' }, at(T2));
    await tablet.sync();
    await phone.sync();

    const files = github.files(FULL_NAME);
    expect(files.get('notes.txt')).toBe('my notes');
    expect(files.get('data/other/2026-11.json')).toBe('{"not":"ours"}');
    expect(files.get('data/lines/readme.md')).toBe('hello');
    expect(files.get('data/stores/2026-11.json')).toContain('METRO Cluj');
  });

  it('is put in order: a record in the wrong file moves to its own, the stray file goes', async () => {
    const { phone, tablet } = await syncedPair();
    const stores = github.files(FULL_NAME).get('data/stores/2026-11.json') ?? '';
    // The same file under a name no device would give it.
    await github.push(FULL_NAME, {
      'data/stores/2026-01.json': stores,
      'data/stores/2026-11.json': null,
    });

    await tablet.sync();
    await phone.sync();

    const files = github.files(FULL_NAME);
    expect(files.has('data/stores/2026-01.json')).toBe(false);
    expect(files.get('data/stores/2026-11.json')).toBe(stores);
    expect(await snapshot(tablet.db)).toEqual(await snapshot(phone.db));
  });

  it('settles a record that two files disagree about by its timestamp', async () => {
    const { phone, tablet } = await syncedPair();
    const stores = github.files(FULL_NAME).get('data/stores/2026-11.json') ?? '';
    const newer = stores
      .replace('Lidl Cluj', 'Lidl Iași')
      .replace(/"updatedAt":"[^"]+"/, `"updatedAt":"${T3}"`);
    await github.push(FULL_NAME, { 'data/stores/2026-01.json': newer });

    await tablet.sync();
    await phone.sync();

    for (const device of [phone, tablet]) {
      expect(
        (await listActive(device.db.stores)).map((s) => s.name),
        device.label,
      ).toEqual(['Lidl Iași']);
    }
    expect(github.files(FULL_NAME).has('data/stores/2026-01.json')).toBe(false);
  });

  it('is not held up by a local record that no longer satisfies its schema', async () => {
    const { phone } = await twoDevices();
    await seedSample(phone.db);
    await phone.db.products.put({ ...makeProduct(), baseUnit: 'rolă' as 'role' });

    const result = await phone.sync();

    expect(result.skipped).toBe(1);
    expect(github.files(FULL_NAME).get('data/products/2026-11.json')).not.toContain('rolă');
  });
});

describe('what the repository history says', () => {
  it('counts one record in the singular', async () => {
    const { phone } = await twoDevices();
    await seedSample(phone.db);
    await phone.sync();

    await createRecord(phone.db.stores, { chain: 'kaufland', name: 'Nou' }, at(T1));
    await phone.sync();

    expect(github.history(FULL_NAME)[0]?.message).toBe(
      'Sincronizare Pretometru (dispozitiv PHONE1): 1 înregistrare',
    );
  });
});
