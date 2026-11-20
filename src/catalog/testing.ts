/**
 * Test-only builders: parser output and receipts saved in a test database.
 * Never import this from application code.
 */
import type {
  Chain,
  Line,
  LineKind,
  PackUnit,
  ParsedLine,
  ParsedReceipt,
  QtyUnit,
  Receipt,
  Store,
} from '@/domain';
import { createRecord, saveReceipt, type PretometruDB } from '@/storage';

type LineSpec = Partial<ParsedLine> & { rawName: string };

/** A valid receipt of product lines (1 buc, 5,99 lei each unless overridden); `idx` is assigned. */
export function parsedReceipt(chain: Chain, lines: readonly LineSpec[]): ParsedReceipt {
  const full: ParsedLine[] = lines.map((line, idx) => ({
    qty: 1,
    qtyUnit: 'buc',
    kind: 'product',
    lineTotalBani: 599,
    ...line,
    idx,
  }));
  return {
    schemaVersion: 1,
    chain,
    docType: 'receipt',
    purchasedAt: '2026-11-07T14:32',
    currency: 'RON',
    totals: { grandTotalBani: full.reduce((sum, line) => sum + line.lineTotalBani, 0) },
    lines: full,
    meta: { engine: 'fixture', parser: 'test', parserVersion: '1.0.0', warnings: [] },
  };
}

export interface TestLine {
  rawName: string;
  /** VAT-inclusive amount after discount, in bani. */
  lineTotalBani: number;
  qty?: number;
  unit?: QtyUnit;
  discountBani?: number;
  kind?: LineKind;
  ean?: string;
  productId?: string;
  categoryId?: string;
  pack?: { qty: number; unit: PackUnit; unitsPerPack?: number };
}

export interface TestReceipt {
  chain: Chain;
  lines: readonly TestLine[];
  purchasedAt?: string;
  status?: 'draft' | 'confirmed';
}

const CHAIN_NAMES: Record<Chain, string> = {
  kaufland: 'Kaufland',
  metro: 'METRO',
  'mega-image': 'Mega Image',
  lidl: 'Lidl',
  unknown: 'Magazin',
};

/** The store of a chain, created on first use (one per chain, so tests compare chains). */
export async function testStore(db: PretometruDB, chain: Chain): Promise<Store> {
  const existing = await db.stores.where('chain').equals(chain).first();
  return existing ?? createRecord(db.stores, { chain, name: CHAIN_NAMES[chain] });
}

/** Saves a confirmed receipt (unless `status` says otherwise) through `saveReceipt`, like the importer does. */
export async function saveTestReceipt(
  db: PretometruDB,
  { chain, lines, purchasedAt = '2026-11-07T14:32', status = 'confirmed' }: TestReceipt,
): Promise<{ receipt: Receipt; lines: Line[]; store: Store }> {
  const store = await testStore(db, chain);
  const saved = await saveReceipt(
    db,
    {
      storeId: store.id,
      purchasedAt,
      docType: 'receipt',
      totalBani: lines.reduce((sum, line) => sum + line.lineTotalBani, 0),
      source: { kind: 'manual' },
      extraction: { engine: 'manual', parser: 'test', version: '1.0.0', warnings: [] },
      status,
    },
    lines.map((line, idx) => ({
      idx,
      rawName: line.rawName,
      qty: line.qty ?? 1,
      unit: line.unit ?? 'buc',
      lineTotalBani: line.lineTotalBani,
      discountBani: line.discountBani ?? 0,
      kind: line.kind ?? 'product',
      ...(line.ean !== undefined ? { ean: line.ean } : {}),
      ...(line.productId !== undefined ? { productId: line.productId } : {}),
      ...(line.categoryId !== undefined ? { categoryId: line.categoryId } : {}),
      ...(line.pack
        ? {
            packQty: line.pack.qty,
            packUnit: line.pack.unit,
            ...(line.pack.unitsPerPack !== undefined
              ? { unitsPerPack: line.pack.unitsPerPack }
              : {}),
          }
        : {}),
    })),
  );
  return { ...saved, store };
}
