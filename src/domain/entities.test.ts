import { describe, expect, it } from 'vitest';
import { InstantSchema } from './common';
import {
  CategorySchema,
  KeyValueSchema,
  LineSchema,
  ReceiptSchema,
  SYNCED_ENTITY_SCHEMAS,
} from './entities';
import {
  makeAlias,
  makeCategory,
  makeLine,
  makeList,
  makeListItem,
  makeProduct,
  makeReceipt,
  makeStore,
} from './testing';

describe('persisted entities', () => {
  const samples = {
    stores: makeStore(),
    receipts: makeReceipt(),
    lines: makeLine(),
    products: makeProduct(),
    aliases: makeAlias(),
    categories: makeCategory(),
    lists: makeList(),
    listItems: makeListItem(),
  };

  it('has a sample that every synced schema accepts', () => {
    for (const [table, schema] of Object.entries(SYNCED_ENTITY_SCHEMAS)) {
      const sample = samples[table as keyof typeof samples];
      expect(schema.safeParse(sample).success, table).toBe(true);
    }
  });

  it.each(Object.keys(SYNCED_ENTITY_SCHEMAS))('%s: rejects an id that is not a ULID', (table) => {
    const schema = SYNCED_ENTITY_SCHEMAS[table as keyof typeof SYNCED_ENTITY_SCHEMAS];
    const sample = { ...samples[table as keyof typeof samples], id: 'not-a-ulid' };
    const result = schema.safeParse(sample);
    expect(result.success ? [] : result.error.issues.map((i) => i.path.join('.'))).toContain('id');
  });

  it.each(Object.keys(SYNCED_ENTITY_SCHEMAS))('%s: rejects unknown fields', (table) => {
    const schema = SYNCED_ENTITY_SCHEMAS[table as keyof typeof SYNCED_ENTITY_SCHEMAS];
    const sample = { ...samples[table as keyof typeof samples], surprise: 1 };
    expect(schema.safeParse(sample).success).toBe(false);
  });

  it('requires sync timestamps to be UTC instants with exactly 3 ms digits (LWW compares them as strings)', () => {
    expect(InstantSchema.safeParse('2026-11-20T11:05:08.959Z').success).toBe(true);
    expect(InstantSchema.safeParse('2026-11-20T13:05:08.959+02:00').success).toBe(false);
    expect(InstantSchema.safeParse('2026-11-20').success).toBe(false);
    // "…08Z" would sort after "…08.500Z" although it is earlier
    expect(InstantSchema.safeParse('2026-11-20T11:05:08Z').success).toBe(false);
    expect(InstantSchema.safeParse('2026-11-20T11:05:08.9Z').success).toBe(false);
  });
});

describe('ReceiptSchema', () => {
  it('lets a draft omit the purchase date but not a confirmed receipt', () => {
    const { purchasedAt: _omitted, ...withoutDate } = makeReceipt();
    expect(ReceiptSchema.safeParse({ ...withoutDate, status: 'draft' }).success).toBe(true);

    const confirmed = ReceiptSchema.safeParse({ ...withoutDate, status: 'confirmed' });
    expect(confirmed.success).toBe(false);
    expect(confirmed.success ? [] : confirmed.error.issues.map((i) => i.path.join('.'))).toContain(
      'purchasedAt',
    );
  });

  it('keeps only a SHA-256 hex digest as the file hash', () => {
    const bad = makeReceipt({ source: { kind: 'pdf', fileHash: 'abc123' } });
    expect(ReceiptSchema.safeParse(bad).success).toBe(false);
  });
});

describe('LineSchema', () => {
  it('requires packQty and packUnit together', () => {
    expect(LineSchema.safeParse(makeLine({ packQty: 425 })).success).toBe(false);
    expect(LineSchema.safeParse(makeLine({ packUnit: 'ml' })).success).toBe(false);
    expect(LineSchema.safeParse(makeLine({ packQty: 425, packUnit: 'ml' })).success).toBe(true);
  });

  it('stores derived unit prices as integers', () => {
    expect(LineSchema.safeParse(makeLine({ paidUnitBani: 12.5 })).success).toBe(false);
    expect(LineSchema.safeParse(makeLine({ pricePerBaseMilliBani: 3316.67 })).success).toBe(false);
  });

  it('keeps discounts as non-negative amounts', () => {
    expect(LineSchema.safeParse(makeLine({ discountBani: -1 })).success).toBe(false);
  });
});

describe('CategorySchema', () => {
  it('requires a #rrggbb color', () => {
    expect(CategorySchema.safeParse(makeCategory({ color: '#0f766e' })).success).toBe(true);
    expect(CategorySchema.safeParse(makeCategory({ color: 'teal' })).success).toBe(false);
    expect(CategorySchema.safeParse(makeCategory({ color: '#fff' })).success).toBe(false);
  });
});

describe('KeyValueSchema (settings, sync state)', () => {
  const base = { key: 'priceWindowDays', updatedAt: '2026-11-20T10:00:00.000Z' };

  it('holds any JSON value', () => {
    for (const value of [90, 'x', true, null, { a: [1, 2] }]) {
      expect(KeyValueSchema.safeParse({ ...base, value }).success, JSON.stringify(value)).toBe(
        true,
      );
    }
  });

  it('rejects values that cannot be exported as JSON', () => {
    expect(KeyValueSchema.safeParse({ ...base, value: () => 1 }).success).toBe(false);
    expect(KeyValueSchema.safeParse({ ...base, value: undefined }).success).toBe(false);
  });
});
