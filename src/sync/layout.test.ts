import { describe, expect, it } from 'vitest';
import { createIdGenerator } from '@/domain';
import { makeLine, makeStore } from '@/domain/testing';
import {
  bucketOf,
  checkManifest,
  manifestText,
  MAX_SHARD_CHARS,
  parseShard,
  planShards,
  SEED_BUCKET,
  serializeShard,
  SYNC_FORMAT_VERSION,
  tableOfShardPath,
} from './layout';
import {
  identityOf,
  makeRecord,
  newerOf,
  overlay,
  validateRecords,
  type SyncRecord,
} from './records';

const idAt = (iso: string) =>
  createIdGenerator({ now: () => Date.parse(iso), randomBytes: (n) => new Uint8Array(n) })();

const store = (iso: string, name = 'Lidl') => makeStore({ id: idAt(iso), name });

describe('bucketOf', () => {
  it('puts a record in the month (UTC) its id was created in', () => {
    expect(bucketOf(idAt('2026-11-20T10:00:00.000Z'))).toBe('2026-11');
    expect(bucketOf(idAt('2026-12-31T23:59:59.999Z'))).toBe('2026-12');
    expect(bucketOf(idAt('2027-01-01T00:00:00.000Z'))).toBe('2027-01');
  });

  it('keeps the built-in ids, which no clock created, apart', () => {
    expect(bucketOf('0000000000SEEDCATEG0000001')).toBe(SEED_BUCKET);
  });
});

describe('tableOfShardPath', () => {
  it.each([
    ['data/lines/2026-11.json', 'lines'],
    ['data/listItems/2026-11.A.json', 'listItems'],
    ['data/categories/seed.json', 'categories'],
    ['data/settings.json', 'settings'],
  ])('knows %s', (path, table) => {
    expect(tableOfShardPath(path)).toBe(table);
  });

  it.each([
    'README.md',
    'data/pretometru.json',
    'data/other/2026-11.json',
    'data/lines/nested/2026-11.json',
    'data/lines/2026-11.txt',
    'elsewhere/data/lines/2026-11.json',
  ])('leaves %s alone', (path) => {
    expect(tableOfShardPath(path)).toBeUndefined();
  });
});

describe('planShards', () => {
  const records = () => [
    makeRecord('stores', store('2026-11-02T10:00:00.000Z', 'Mega')),
    makeRecord('stores', store('2026-11-01T10:00:00.000Z', 'Kaufland')),
    makeRecord('stores', store('2026-10-30T10:00:00.000Z', 'METRO')),
    makeRecord('settings', {
      key: 'priceWindowDays',
      value: 60,
      updatedAt: '2026-11-01T00:00:00.000Z',
    }),
  ];

  it('writes one file per table and month, one record per line, sorted by id', () => {
    const files = planShards(records());
    expect(files.map((file) => file.path)).toEqual([
      'data/settings.json',
      'data/stores/2026-10.json',
      'data/stores/2026-11.json',
    ]);
    const november = files.find((file) => file.path === 'data/stores/2026-11.json');
    expect(
      november?.records.map((record) => (JSON.parse(record.text) as { name: string }).name),
    ).toEqual(['Kaufland', 'Mega']);
    // Two header lines, one line per record, two footer lines: a changed record is one changed line.
    expect(november?.text.trimEnd().split('\n')).toHaveLength(2 + 2 + 2);
  });

  it('is a pure function of the record set: order and device never matter', () => {
    const forward = planShards(records());
    const backward = planShards(records().reverse());
    expect(backward.map((file) => [file.path, file.text])).toEqual(
      forward.map((file) => [file.path, file.text]),
    );
  });

  it('splits a month that outgrows the limit by the first random character of the id', () => {
    // One id a second through the month, as real use creates them: each gets a fresh random part.
    let clock = Date.parse('2026-11-10T10:00:00.000Z');
    const next = createIdGenerator({ now: () => (clock += 1000) });
    const lines = Array.from({ length: 5000 }, (_, index) =>
      makeRecord(
        'lines',
        makeLine({ id: next(), rawName: `PRODUS ${index} ${'x'.repeat(120)}`, receiptId: next() }),
      ),
    );
    expect(serializeShard(lines).length).toBeGreaterThan(MAX_SHARD_CHARS);

    const files = planShards(lines);
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      expect(file.path).toMatch(/^data\/lines\/2026-11\.[0-9A-Z]\.json$/);
      expect(file.text.length).toBeLessThanOrEqual(MAX_SHARD_CHARS);
    }
    expect(files.reduce((sum, file) => sum + file.records.length, 0)).toBe(5000);
  });
});

describe('parseShard and validateRecords', () => {
  it('reads back what serializeShard wrote', () => {
    const original = [makeRecord('stores', store('2026-11-01T10:00:00.000Z'))];
    const raw = parseShard('data/stores/2026-11.json', serializeShard(original));
    expect(validateRecords('stores', raw, 'data/stores/2026-11.json').map((r) => r.text)).toEqual(
      original.map((r) => r.text),
    );
  });

  it.each([
    ['not json', '{'],
    ['no records', '{"other":[]}'],
    ['extra keys', '{"records":[],"extra":1}'],
    ['records of the wrong kind', '{"records":"x"}'],
  ])('rejects a file with %s, naming it', (_name, text) => {
    expect(() => parseShard('data/stores/2026-11.json', text)).toThrow(
      expect.objectContaining({ code: 'REMOTE_INVALID', detail: 'data/stores/2026-11.json' }),
    );
  });

  it('rejects a record that breaks its contract, naming the file, the record and the field', () => {
    const bad = { ...makeStore(), chain: 'not-a-chain' };
    expect(() => validateRecords('stores', [makeStore(), bad], 'data/stores/2026-11.json')).toThrow(
      expect.objectContaining({
        code: 'REMOTE_INVALID',
        detail: expect.stringMatching(/data\/stores\/2026-11\.json, record 2 \(chain/) as string,
      }),
    );
  });
});

describe('manifest', () => {
  it('accepts its own text and older or equal versions', () => {
    expect(() => checkManifest(manifestText())).not.toThrow();
  });

  it('refuses data written by a newer app, and files that are not a manifest', () => {
    const newer = JSON.stringify({
      format: 'pretometru-data',
      formatVersion: SYNC_FORMAT_VERSION + 1,
    });
    expect(() => checkManifest(newer)).toThrow(expect.objectContaining({ code: 'REMOTE_NEWER' }));
    for (const text of ['', '{}', '{"format":"other","formatVersion":1}', '[]']) {
      expect(() => checkManifest(text)).toThrow(
        expect.objectContaining({ code: 'REMOTE_INVALID' }),
      );
    }
  });
});

describe('last write wins', () => {
  const at = (updatedAt: string, name: string): SyncRecord =>
    makeRecord('stores', { ...makeStore({ id: '0'.repeat(26) }), updatedAt, name });

  it('keeps the newer copy, and on a tie the one already held', () => {
    const early = at('2026-11-01T10:00:00.000Z', 'early');
    const late = at('2026-11-02T10:00:00.000Z', 'late');
    const tie = at('2026-11-02T10:00:00.000Z', 'tie');
    expect(newerOf(early, late)).toBe(late);
    expect(newerOf(late, early)).toBe(late);
    expect(newerOf(late, tie)).toBe(late);
    expect(newerOf(tie, late)).toBe(tie);
  });

  it('overlays records of any table by identity', () => {
    const first = at('2026-11-01T10:00:00.000Z', 'x');
    const base = new Map([[identityOf(first), first]]);
    overlay(base, [at('2026-11-03T10:00:00.000Z', 'newer')]);
    expect(base.size).toBe(1);
    expect(JSON.parse([...base.values()][0]?.text ?? '{}')).toMatchObject({ name: 'newer' });
  });
});
