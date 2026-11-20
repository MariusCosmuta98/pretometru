import { describe, expect, it } from 'vitest';
import { createBackup, parseBackup, serializeBackup, type BackupData } from './backup';
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

function populated(): BackupData {
  const category = makeCategory();
  const store = makeStore();
  const product = makeProduct({ categoryId: category.id });
  const receipt = makeReceipt({ storeId: store.id });
  const list = makeList();
  return {
    stores: [store],
    receipts: [receipt],
    lines: [makeLine({ receiptId: receipt.id, productId: product.id, categoryId: category.id })],
    products: [product],
    aliases: [makeAlias({ productId: product.id })],
    categories: [category],
    lists: [list],
    listItems: [makeListItem({ listId: list.id, productId: product.id })],
    settings: [{ key: 'priceWindowDays', value: 60, updatedAt: '2026-11-20T10:00:00.000Z' }],
  };
}

const NOW = new Date('2026-11-20T11:05:08.959Z');

describe('parseBackup', () => {
  it('reads back exactly what serializeBackup wrote', () => {
    const backup = createBackup(populated(), NOW);
    const result = parseBackup(serializeBackup(backup));
    expect(result).toEqual({ ok: true, backup, warnings: [] });
  });

  it('stamps the format, its version and the export time', () => {
    expect(createBackup(populated(), NOW)).toMatchObject({
      format: 'pretometru-backup',
      formatVersion: 1,
      exportedAt: '2026-11-20T11:05:08.959Z',
    });
  });

  it('explains text that is not JSON, and JSON that is not a backup', () => {
    expect(parseBackup('{oops')).toEqual({
      ok: false,
      errors: ['The file is not valid JSON.'],
    });
    expect(parseBackup('{"hello":"world"}')).toEqual({
      ok: false,
      errors: ['This is not a Pretometru backup file.'],
    });
  });

  it('refuses a backup written by a newer version of the app instead of dropping fields', () => {
    const result = parseBackup('{"format":"pretometru-backup","formatVersion":2}');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toMatch(/newer version/);
  });

  it('reports schema problems with the table and row they come from', () => {
    const data = populated();
    const broken = {
      ...createBackup(data, NOW),
      data: { ...data, lines: [{ ...data.lines[0], qty: -1 }] },
    };
    const result = parseBackup(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((e) => e.startsWith('data.lines.0.qty'))).toBe(true);
  });

  it('rejects two rows with the same id in one table', () => {
    const data = populated();
    const store = data.stores[0]!;
    const result = parseBackup(
      JSON.stringify(createBackup({ ...data, stores: [store, { ...store, name: 'Copy' }] }, NOW)),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join('\n')).toMatch(/stores.*duplicate id/i);
  });

  it('accepts dangling references but warns about them', () => {
    const data = populated();
    const result = parseBackup(JSON.stringify(createBackup({ ...data, receipts: [] }, NOW)));
    expect(result.ok).toBe(true);
    expect(result.ok && result.warnings).toEqual([
      '1 line(s) reference a receipt that is not in the backup',
    ]);
  });

  it('reports instead of throwing on a hostile file (deeply nested JSON value)', () => {
    const depth = 100_000;
    const nested = `${'['.repeat(depth)}${']'.repeat(depth)}`;
    const hostile =
      '{"format":"pretometru-backup","formatVersion":1,"exportedAt":"2026-11-20T12:00:00.000Z",' +
      '"data":{"stores":[],"receipts":[],"lines":[],"products":[],"aliases":[],"categories":[],' +
      '"lists":[],"listItems":[],"settings":[{"key":"k","updatedAt":"2026-11-20T12:00:00.000Z",' +
      `"value":${nested}}]}}`;

    expect(() => parseBackup(hostile)).not.toThrow();
    expect(parseBackup(hostile).ok).toBe(false);
  });
});
