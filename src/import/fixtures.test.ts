import { getFixture, sourceOf } from '@fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSeed, getReceiptWithLines } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { defaultParser } from './engines';
import { importReceipt, importToDraft } from './pipeline';
import { clearReviewSessions } from './session';
import { fakeEngines, fakeParser, pdfFile, testServices } from './testing';

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  db = await createTestDb();
  await ensureSeed(db);
});
afterEach(clearReviewSessions);

/** Imports the PDF fixture as the parsers would deliver it: the ground truth, validated. */
async function importFixture(id: string) {
  const fixture = getFixture(id);
  const { source, expected } = sourceOf(fixture, 'pdf-text');
  const services = testServices(db, {
    parser: fakeParser(expected),
    engines: fakeEngines({ pdf: source }),
    now: () => new Date(fixture.now),
  });
  const outcome = await importToDraft(services, { kind: 'file', file: pdfFile(`${id}.pdf`) });
  const stored = await getReceiptWithLines(db, outcome.saved.receipt.id);
  if (!stored) throw new Error('the draft was not saved');
  return { expected, outcome, ...stored };
}

describe('ground-truth receipts', () => {
  it('stores the Kaufland receipt as printed, voucher included', async () => {
    const { expected, receipt, lines, outcome } = await importFixture('kaufland-2026-11-07');

    expect(receipt).toMatchObject({
      status: 'draft',
      purchasedAt: '2026-11-07T18:31:47',
      receiptNo: '12345',
      docType: 'receipt',
      totalBani: 20879,
      paidBani: 18879,
      extraction: { engine: 'fixture', parser: 'ground-truth', warnings: [] },
    });
    expect(outcome.saved.store).toMatchObject({ chain: 'kaufland', branchCode: '4670' });
    expect(lines.map((line) => [line.idx, line.rawName, line.kind, line.lineTotalBani])).toEqual(
      expected.lines.map((line) => [line.idx, line.rawName, line.kind, line.lineTotalBani]),
    );
    expect(lines.reduce((sum, line) => sum + line.lineTotalBani, 0)).toBe(20879);
  });

  it('derives the unit prices the plan promises (Kaufland)', async () => {
    const { lines } = await importFixture('kaufland-2026-11-07');
    const byName = (name: string) => {
      const line = lines.find((candidate) => candidate.rawName === name);
      if (!line) throw new Error(`no line ${name}`);
      return line;
    };

    // Chicken legs: 22,99 lei for 0,920 kg = 24,99 lei/kg.
    expect(byName('PULPE DEZOSATE TV')).toMatchObject({
      baseUnit: 'kg',
      paidUnitBani: 2499,
      pricePerBaseMilliBani: 2_498_913,
    });
    // Toilet paper: 3 packs of 8 rolls for 34,77 lei = 1,45 lei per roll.
    expect(byName('KLC HARTIE IG 8ROLE')).toMatchObject({
      baseUnit: 'role',
      paidUnitBani: 1159,
      pricePerBaseMilliBani: 144_875,
    });
    // Wet wipes: 6,99 lei a pack of 120 = 5,825 bani a wipe.
    expect(byName('BUBUBEBE SERV 120BUC')).toMatchObject({
      baseUnit: 'buc',
      paidUnitBani: 699,
      pricePerBaseMilliBani: 5825,
    });
  });

  it('stores the METRO invoice with its discounts and derives the prices after them', async () => {
    const { receipt, lines, outcome } = await importFixture('metro-invoice-2026-08-12');

    expect(receipt).toMatchObject({
      docType: 'invoice',
      totalBani: 36341,
      receiptNo: '1234567890123456',
      // 36.342 lei in lines against 36.341 printed: inside the tolerance, so no warning.
      extraction: { warnings: [] },
    });
    expect(outcome.saved.store).toMatchObject({ chain: 'metro', city: 'Cluj' });
    expect(lines.find((line) => line.rawName === '120BUC ARO BABY SERVETELE UMED')).toMatchObject({
      ean: '5948792073282',
      discountBani: 301,
      lineTotalBani: 1194,
      // 3 packs for 11,94 lei after the discount: 3,98 lei a pack of 120.
      paidUnitBani: 398,
      baseUnit: 'buc',
      pricePerBaseMilliBani: 3317,
    });
    // Toilet paper: 3 packs of 8 rolls for 31,26 lei after the discount = 1,30 lei per roll.
    expect(lines.find((line) => line.rawName === '8 ROLE FL H IG ALBA 3STR')).toMatchObject({
      baseUnit: 'role',
      paidUnitBani: 1042,
      pricePerBaseMilliBani: 130_250,
    });
  });
});

describe('the real parsers behind the import', () => {
  it.each(['kaufland-2026-11-07', 'metro-invoice-2026-08-12'])(
    'turn the %s PDF text into the ground-truth draft',
    async (id) => {
      const fixture = getFixture(id);
      const { source, expected } = sourceOf(fixture, 'pdf-text');
      const services = testServices(db, {
        parser: defaultParser,
        engines: fakeEngines({ pdf: source }),
        now: () => new Date(fixture.now),
      });

      const { draft } = await importReceipt(services, {
        kind: 'file',
        file: pdfFile(`${id}.pdf`),
      });

      expect(draft.store.chain).toBe(expected.chain);
      expect(draft.totalBani).toBe(expected.totals.grandTotalBani);
      expect(draft.purchasedAt).toBe(expected.purchasedAt);
      expect(draft.extraction.engine).toBe('pdfjs');
      expect(draft.lines.map((line) => [line.rawName, line.kind, line.lineTotalBani])).toEqual(
        expected.lines.map((line) => [line.rawName, line.kind, line.lineTotalBani]),
      );
      expect(draft.extraction.warnings).toEqual([]);
    },
  );
});
