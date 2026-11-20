/**
 * Test-only helpers for the spending tests and the Home and Statistics screens: receipts saved with
 * `saveReceipt` the way the importer saves them (paid amount included). Never import this from
 * application code.
 */
import { suggestMappings } from '@/catalog';
import { testStore } from '@/catalog/testing';
import type {
  Chain,
  Line,
  LineKind,
  PackUnit,
  ParsedReceipt,
  QtyUnit,
  Receipt,
  Store,
} from '@/domain';
import { ensureSeed, getDb, saveReceipt, type LineInput, type PretometruDB } from '@/storage';
import { getFixture } from '@fixtures';

export interface SavedReceipt {
  receipt: Receipt;
  lines: Line[];
  store: Store;
}

/**
 * The ground truth of a fixture saved as the import flow does it before the user maps anything: the
 * catalog's category hints fill the categories, the printed paid amount is kept, products stay unset.
 * A receipt without a date can only be a draft.
 */
export async function saveGroundTruth(
  db: PretometruDB,
  fixtureId: string,
  { status }: { status?: 'draft' | 'confirmed' } = {},
): Promise<SavedReceipt> {
  const parsed: ParsedReceipt = getFixture(fixtureId).expected;
  const mappings = await suggestMappings(db, parsed);
  const store = await testStore(db, parsed.chain);

  const lines = parsed.lines.map((line, index): LineInput => {
    const categoryId = mappings[index]?.categoryId;
    return {
      idx: line.idx,
      rawName: line.rawName,
      qty: line.qty,
      unit: line.qtyUnit,
      lineTotalBani: line.lineTotalBani,
      discountBani: line.discountBani ?? 0,
      kind: line.kind,
      ...(line.ean ? { ean: line.ean } : {}),
      ...(line.vatRate === undefined ? {} : { vatRate: line.vatRate }),
      ...(line.storeCategoryHint ? { storeCategoryHint: line.storeCategoryHint } : {}),
      ...(categoryId === undefined ? {} : { categoryId }),
      ...(line.pack ? { packQty: line.pack.qty, packUnit: line.pack.unit } : {}),
    };
  });

  const saved = await saveReceipt(
    db,
    {
      storeId: store.id,
      ...(parsed.purchasedAt ? { purchasedAt: parsed.purchasedAt } : {}),
      ...(parsed.documentNo ? { receiptNo: parsed.documentNo } : {}),
      docType: parsed.docType,
      totalBani: parsed.totals.grandTotalBani,
      ...(parsed.totals.paidBani === undefined ? {} : { paidBani: parsed.totals.paidBani }),
      source: { kind: 'pdf' },
      extraction: {
        engine: 'fixture',
        parser: parsed.meta.parser,
        version: parsed.meta.parserVersion,
        warnings: [],
      },
      status: status ?? (parsed.purchasedAt ? 'confirmed' : 'draft'),
    },
    lines,
  );
  return { ...saved, store };
}

export interface PurchaseLine {
  rawName?: string;
  lineTotalBani: number;
  kind?: LineKind;
  discountBani?: number;
  qty?: number;
  unit?: QtyUnit;
  productId?: string;
  categoryId?: string;
  pack?: { qty: number; unit: PackUnit };
}

export interface Purchase {
  /** Saves over this receipt (its lines are replaced) instead of creating a new one. */
  id?: string;
  chain: Chain;
  /** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm[:ss]`. */
  purchasedAt: string;
  lines: readonly PurchaseLine[];
  /** The printed total; the sum of the lines when omitted. */
  totalBani?: number;
  /** What was paid; absent when the receipt does not say. */
  paidBani?: number;
  status?: 'draft' | 'confirmed';
}

/** A hand-made receipt saved through `saveReceipt` (confirmed unless `status` says otherwise). */
export async function savePurchase(db: PretometruDB, purchase: Purchase): Promise<SavedReceipt> {
  const store = await testStore(db, purchase.chain);
  const saved = await saveReceipt(
    db,
    {
      ...(purchase.id === undefined ? {} : { id: purchase.id }),
      storeId: store.id,
      purchasedAt: purchase.purchasedAt,
      docType: 'receipt',
      totalBani:
        purchase.totalBani ?? purchase.lines.reduce((sum, line) => sum + line.lineTotalBani, 0),
      ...(purchase.paidBani === undefined ? {} : { paidBani: purchase.paidBani }),
      source: { kind: 'manual' },
      extraction: { engine: 'manual', parser: 'test', version: '1.0.0', warnings: [] },
      status: purchase.status ?? 'confirmed',
    },
    purchase.lines.map((line, idx): LineInput => ({
      idx,
      rawName: line.rawName ?? `ARTICOL ${idx + 1}`,
      qty: line.qty ?? 1,
      unit: line.unit ?? 'buc',
      lineTotalBani: line.lineTotalBani,
      discountBani: line.discountBani ?? 0,
      kind: line.kind ?? 'product',
      ...(line.productId === undefined ? {} : { productId: line.productId }),
      ...(line.categoryId === undefined ? {} : { categoryId: line.categoryId }),
      ...(line.pack ? { packQty: line.pack.qty, packUnit: line.pack.unit } : {}),
    })),
  );
  return { ...saved, store };
}

/**
 * The shared app database (fake-indexeddb) emptied and seeded with the categories: what the screens
 * read in tests. Import `fake-indexeddb/auto` first in the test file.
 */
export async function resetAppDb(): Promise<PretometruDB> {
  const db = await getDb();
  await Promise.all(db.tables.map((table) => table.clear()));
  await ensureSeed(db);
  return db;
}

/** The four real receipts of tests/fixtures, saved: METRO in August, Mega Image and Kaufland in November, Lidl in December. */
export async function saveRealReceipts(db: PretometruDB): Promise<Record<string, SavedReceipt>> {
  return {
    metro: await saveGroundTruth(db, 'metro-invoice-2026-08-12'),
    mega: await saveGroundTruth(db, 'mega-image-2026-11-03'),
    kaufland: await saveGroundTruth(db, 'kaufland-2026-11-07'),
    lidl: await saveGroundTruth(db, 'lidl-2026-12-29'),
  };
}
