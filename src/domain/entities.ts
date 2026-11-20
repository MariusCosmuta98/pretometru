import { z } from 'zod';
import {
  BaniSchema,
  EanSchema,
  InstantSchema,
  NonEmptyTextSchema,
  QtySchema,
  SemverSchema,
  UnitIntervalSchema,
  VatRateSchema,
} from './common';
import { PurchasedAtSchema } from './dates';
import { IdSchema } from './ids';
import {
  ChainSchema,
  DocTypeSchema,
  ExtractionEngineSchema,
  LineKindSchema,
  ParseWarningSchema,
} from './parsed-receipt';
import { BaseUnitSchema, PackUnitSchema, QtyUnitSchema } from './units';

/**
 * Fields every synced record carries. Records are never hard-deleted: `deletedAt` marks a
 * tombstone so the deletion can propagate, and `updatedAt` (UTC instant) drives last-write-wins.
 */
const synced = {
  id: IdSchema,
  updatedAt: InstantSchema,
  deletedAt: InstantSchema.optional(),
} as const;

export const StoreSchema = z.strictObject({
  ...synced,
  chain: ChainSchema,
  name: NonEmptyTextSchema,
  branchCode: NonEmptyTextSchema.optional(),
  city: NonEmptyTextSchema.optional(),
  address: NonEmptyTextSchema.optional(),
});
export type Store = z.infer<typeof StoreSchema>;

export const SOURCE_KINDS = ['pdf', 'image', 'text', 'manual'] as const;
export const SourceKindSchema = z.enum(SOURCE_KINDS);

export const RECEIPT_STATUSES = ['draft', 'confirmed'] as const;
export const ReceiptStatusSchema = z.enum(RECEIPT_STATUSES);
export type ReceiptStatus = z.infer<typeof ReceiptStatusSchema>;

export const ReceiptSchema = z
  .strictObject({
    ...synced,
    storeId: IdSchema,
    /** Required once confirmed; a draft may still be missing it (MISSING_DATE warning). */
    purchasedAt: PurchasedAtSchema.optional(),
    /** `documentNo` of the parsed receipt. */
    receiptNo: NonEmptyTextSchema.optional(),
    docType: DocTypeSchema,
    /** Printed TOTAL of goods (VAT-inclusive, before payment-side vouchers). */
    totalBani: BaniSchema,
    /** Amount actually paid (total minus payment-side vouchers). */
    paidBani: BaniSchema.optional(),
    /**
     * When the set of lines was last replaced (`saveReceipt`). Lines stamped before it belong to an
     * older version of the set (they can arrive from another device through a merge) and are
     * tombstoned by `reconcileReceiptLines`.
     */
    linesUpdatedAt: InstantSchema.optional(),
    source: z.strictObject({
      kind: SourceKindSchema,
      /** SHA-256 (hex) of the original file, for duplicate detection. */
      fileHash: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .optional(),
      fileName: NonEmptyTextSchema.optional(),
      /** PII-free extracted text kept so a newer parser can re-process the receipt. */
      rawText: z.string().optional(),
    }),
    extraction: z.strictObject({
      engine: ExtractionEngineSchema,
      parser: NonEmptyTextSchema,
      version: SemverSchema,
      confidence: UnitIntervalSchema.optional(),
      warnings: z.array(ParseWarningSchema),
    }),
    status: ReceiptStatusSchema,
  })
  .superRefine((receipt, ctx) => {
    if (receipt.status === 'confirmed' && receipt.purchasedAt === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'A confirmed receipt needs a purchase date',
        path: ['purchasedAt'],
      });
    }
  });
export type Receipt = z.infer<typeof ReceiptSchema>;

export const LineSchema = z
  .strictObject({
    ...synced,
    receiptId: IdSchema,
    idx: z.int().min(0),
    rawName: NonEmptyTextSchema,
    ean: EanSchema.optional(),
    qty: QtySchema,
    unit: QtyUnitSchema,
    /** VAT-inclusive amount charged after discount (same meaning as in ParsedLine). */
    lineTotalBani: BaniSchema,
    /** Discount already reflected in `lineTotalBani`; kept to tell regular from sale prices. */
    discountBani: BaniSchema.min(0),
    vatRate: VatRateSchema.optional(),
    kind: LineKindSchema,
    storeCategoryHint: NonEmptyTextSchema.optional(),
    productId: IdSchema.optional(),
    categoryId: IdSchema.optional(),
    /** Content of ONE sold unit (`packQty` and `packUnit` come together). */
    packQty: QtySchema.optional(),
    packUnit: PackUnitSchema.optional(),
    /** Consumer units per sold unit when known (`6X2L` -> 6). Informational. */
    unitsPerPack: z.int().min(1).optional(),
    // Derived by `unitPricing()`; always recomputed when a line is saved.
    paidUnitBani: BaniSchema,
    baseUnit: BaseUnitSchema,
    /** Price per `baseUnit` in milli-bani (1/1000 ban): keeps precision for cheap pieces. */
    pricePerBaseMilliBani: z.int(),
  })
  .superRefine((line, ctx) => {
    if ((line.packQty === undefined) !== (line.packUnit === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'packQty and packUnit must be set together',
        path: [line.packQty === undefined ? 'packQty' : 'packUnit'],
      });
    }
  });
export type Line = z.infer<typeof LineSchema>;

export const ProductSchema = z.strictObject({
  ...synced,
  name: NonEmptyTextSchema,
  brand: NonEmptyTextSchema.optional(),
  categoryId: IdSchema,
  ean: EanSchema.optional(),
  /** Unit that prices of this product are compared in. */
  baseUnit: BaseUnitSchema,
});
export type Product = z.infer<typeof ProductSchema>;

export const PackDefaultSchema = z.strictObject({
  qty: QtySchema,
  unit: PackUnitSchema,
  unitsPerPack: z.int().min(1).optional(),
});

/** Remembered match from a printed name (or EAN) to a product, so later imports are automatic. */
export const AliasSchema = z.strictObject({
  ...synced,
  /** Absent: applies to every chain. */
  chain: ChainSchema.optional(),
  /** `normalizeName(rawName)`. */
  normName: NonEmptyTextSchema,
  /** The printed name this alias was learned from (display and re-normalisation). */
  rawName: NonEmptyTextSchema.optional(),
  ean: EanSchema.optional(),
  productId: IdSchema,
  /** Fills in the pack size when the printed name has none (Lidl, Mega Image). */
  defaultPack: PackDefaultSchema.optional(),
});
export type Alias = z.infer<typeof AliasSchema>;

export const CategorySchema = z.strictObject({
  ...synced,
  name: NonEmptyTextSchema,
  parentId: IdSchema.optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #rrggbb'),
  /** An emoji: rendered by the system font, so nothing is fetched at runtime. */
  icon: NonEmptyTextSchema,
  order: z.int(),
  /** The built-in "Non-produs" bucket; not shown in product pickers. */
  system: z.boolean().optional(),
});
export type Category = z.infer<typeof CategorySchema>;

export const ListSchema = z.strictObject({
  ...synced,
  name: NonEmptyTextSchema,
  archivedAt: InstantSchema.optional(),
});
export type List = z.infer<typeof ListSchema>;

export const ListItemSchema = z.strictObject({
  ...synced,
  listId: IdSchema,
  /** Linked product; absent for free-text items. */
  productId: IdSchema.optional(),
  label: NonEmptyTextSchema,
  qty: QtySchema.optional(),
  unit: QtyUnitSchema.optional(),
  note: z.string().optional(),
  checked: z.boolean(),
  checkedAt: InstantSchema.optional(),
  order: z.int(),
});
export type ListItem = z.infer<typeof ListItemSchema>;

/**
 * Backing shape of the `settings` and `syncState` tables. The key is the identity; any JSON value
 * goes, so new keys never need a schema migration.
 */
export const KeyValueSchema = z.strictObject({
  key: z.string().min(1).max(200),
  value: z.json(),
  updatedAt: InstantSchema,
  deletedAt: InstantSchema.optional(),
});
export type KeyValue = z.infer<typeof KeyValueSchema>;

/** Every table of records with `id`, `updatedAt` and `deletedAt`: what backups and sync carry. */
export const SYNCED_ENTITY_SCHEMAS = {
  stores: StoreSchema,
  receipts: ReceiptSchema,
  lines: LineSchema,
  products: ProductSchema,
  aliases: AliasSchema,
  categories: CategorySchema,
  lists: ListSchema,
  listItems: ListItemSchema,
} as const;
export type SyncedTableName = keyof typeof SYNCED_ENTITY_SCHEMAS;
