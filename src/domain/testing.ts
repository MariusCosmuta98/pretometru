/**
 * Test-only builders for persisted entities: valid by default, deterministic ids and timestamps.
 * Never import this from application code.
 */
import type { Alias, Category, Line, List, ListItem, Product, Receipt, Store } from './entities';
import { createIdGenerator } from './ids';

export const TEST_NOW = '2026-11-20T10:00:00.000Z';

const nextId = createIdGenerator({
  now: () => 1_700_000_000_000,
  randomBytes: (length) => new Uint8Array(length),
});

export function makeStore(overrides: Partial<Store> = {}): Store {
  return {
    id: nextId(),
    updatedAt: TEST_NOW,
    chain: 'kaufland',
    name: 'Kaufland Cluj',
    branchCode: '1234',
    city: 'Cluj-Napoca',
    ...overrides,
  };
}

export function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: nextId(),
    updatedAt: TEST_NOW,
    name: 'Lactate & ouă',
    color: '#3b82f6',
    icon: '🥛',
    order: 10,
    ...overrides,
  };
}

export function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: nextId(),
    updatedAt: TEST_NOW,
    name: 'Lapte UHT 1,5%',
    categoryId: nextId(),
    baseUnit: 'l',
    ...overrides,
  };
}

export function makeReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: nextId(),
    updatedAt: TEST_NOW,
    storeId: nextId(),
    purchasedAt: '2026-11-07T14:32',
    docType: 'receipt',
    totalBani: 3666,
    source: { kind: 'pdf', fileHash: 'a'.repeat(64), fileName: 'bon.pdf' },
    extraction: { engine: 'pdfjs', parser: 'kaufland', version: '1.0.0', warnings: [] },
    status: 'confirmed',
    ...overrides,
  };
}

export function makeLine(overrides: Partial<Line> = {}): Line {
  return {
    id: nextId(),
    updatedAt: TEST_NOW,
    receiptId: nextId(),
    idx: 0,
    rawName: 'LAPTE UHT 1L',
    qty: 2,
    unit: 'buc',
    lineTotalBani: 1198,
    discountBani: 0,
    kind: 'product',
    paidUnitBani: 599,
    baseUnit: 'buc',
    pricePerBaseMilliBani: 599_000,
    ...overrides,
  };
}

export function makeAlias(overrides: Partial<Alias> = {}): Alias {
  return {
    id: nextId(),
    updatedAt: TEST_NOW,
    chain: 'kaufland',
    normName: 'lapte uht 1l',
    productId: nextId(),
    ...overrides,
  };
}

export function makeList(overrides: Partial<List> = {}): List {
  return { id: nextId(), updatedAt: TEST_NOW, name: 'Săptămâna asta', ...overrides };
}

export function makeListItem(overrides: Partial<ListItem> = {}): ListItem {
  return {
    id: nextId(),
    updatedAt: TEST_NOW,
    listId: nextId(),
    label: 'Lapte',
    checked: false,
    order: 0,
    ...overrides,
  };
}
