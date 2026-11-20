import { z } from 'zod';
import {
  BaniSchema,
  EanSchema,
  NonEmptyTextSchema,
  QtySchema,
  SemverSchema,
  UnitIntervalSchema,
  VatRateSchema,
} from './common';
import { PurchasedAtSchema } from './dates';
import { PackUnitSchema, QtyUnitSchema } from './units';

export const CHAINS = ['kaufland', 'metro', 'mega-image', 'lidl', 'unknown'] as const;
export const ChainSchema = z.enum(CHAINS);
export type Chain = z.infer<typeof ChainSchema>;

export const DOC_TYPES = ['receipt', 'invoice'] as const;
export const DocTypeSchema = z.enum(DOC_TYPES);
export type DocType = z.infer<typeof DocTypeSchema>;

/**
 * `deposit`: returnable-container deposit ("GARANTIE AMBALAJ"); `bag`: carrier bag;
 * `discount`: standalone discount/coupon line (negative `lineTotalBani`); `fee`: any other
 * non-product charge.
 */
export const LINE_KINDS = ['product', 'deposit', 'bag', 'discount', 'fee'] as const;
export const LineKindSchema = z.enum(LINE_KINDS);
export type LineKind = z.infer<typeof LineKindSchema>;

export const EXTRACTION_ENGINES = [
  'pdfjs',
  'tesseract',
  'gemini',
  'paste',
  'manual',
  'fixture',
] as const;
export const ExtractionEngineSchema = z.enum(EXTRACTION_ENGINES);
export type ExtractionEngine = z.infer<typeof ExtractionEngineSchema>;

export const WARNING_CODES = [
  'SUM_MISMATCH', // sum(lines) != grandTotal beyond tolerance (5 bani)
  'LINE_ARITHMETIC', // qty * unitPrice - discount != lineTotal (tolerance 1 ban)
  'VAT_MISMATCH', // per-rate totals disagree with lines
  'FUTURE_DATE',
  'MISSING_DATE',
  'MISSING_TOTAL',
  'UNKNOWN_CHAIN',
  'LOW_CONFIDENCE',
  'REPAIRED_DIGITS', // an OCR digit-confusion repair was applied
  'DUPLICATE', // same file hash or same store+date+total+documentNo already stored
] as const;
export const WarningCodeSchema = z.enum(WARNING_CODES);
export type WarningCode = z.infer<typeof WarningCodeSchema>;

export const ParseWarningSchema = z.strictObject({
  code: WarningCodeSchema,
  message: z.string(),
  lineIdx: z.int().min(0).optional(),
});
export type ParseWarning = z.infer<typeof ParseWarningSchema>;

const BBoxSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  w: z.number().min(0),
  h: z.number().min(0),
  page: z.int().min(0).optional(),
});

// `rawName` is exactly what is printed, trimmed.
const RawNameSchema = NonEmptyTextSchema.refine((name) => name === name.trim(), 'Must be trimmed');

export const ParsedLineSchema = z.strictObject({
  /** 0-based order among printed lines. */
  idx: z.int().min(0),
  rawName: RawNameSchema,
  kind: LineKindSchema,
  ean: EanSchema.optional(),
  /** Sold units, or kg/l for weighed items. */
  qty: QtySchema,
  qtyUnit: QtyUnitSchema,
  /** Only when printed (or exactly derivable): list price per qty unit before discount. */
  unitPriceBani: BaniSchema.min(0).optional(),
  /** VAT-inclusive discount on this line, >= 0 (ex-VAT documents: converted). */
  discountBani: BaniSchema.min(0).optional(),
  /** VAT-inclusive amount charged after discount; paid unit price = lineTotalBani / qty. */
  lineTotalBani: BaniSchema,
  vatRate: VatRateSchema.optional(),
  /** Printed class letter ('A'..'D'). */
  vatClass: z
    .string()
    .regex(/^[A-Z0-9]{1,3}$/)
    .optional(),
  /** Section header printed on the receipt (Kaufland). */
  storeCategoryHint: NonEmptyTextSchema.optional(),
  /** Content of ONE sold unit parsed from the name: '425ML' -> {425,'ml'}, '8ROLE' -> {8,'role'}. */
  pack: z.strictObject({ qty: QtySchema, unit: PackUnitSchema }).optional(),
  /** 0..1, OCR/AI only. */
  confidence: UnitIntervalSchema.optional(),
  /** Source region for review crops. */
  bbox: BBoxSchema.optional(),
  /** Original printed text of the line(s), PII-free. */
  raw: z.string().optional(),
});
export type ParsedLine = z.infer<typeof ParsedLineSchema>;

const VatTotalSchema = z.strictObject({
  rate: VatRateSchema,
  grossBani: BaniSchema.optional(),
  netBani: BaniSchema.optional(),
  vatBani: BaniSchema.optional(),
});

export const ParsedReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    chain: ChainSchema,
    /** As printed, e.g. 'S.C. LIDL DISCOUNT S.R.L.' */
    storeName: NonEmptyTextSchema.optional(),
    /** Limited to store code and city: no street address, no buyer data. */
    branch: z
      .strictObject({ code: NonEmptyTextSchema.optional(), city: NonEmptyTextSchema.optional() })
      .optional(),
    docType: DocTypeSchema,
    documentNo: NonEmptyTextSchema.optional(),
    /** Local time without zone (Europe/Bucharest implied) or a bare date; may be in the future. */
    purchasedAt: PurchasedAtSchema.optional(),
    currency: z.literal('RON'),
    totals: z.strictObject({
      /** Printed TOTAL of goods, VAT-inclusive, before payment-side vouchers. */
      grandTotalBani: BaniSchema,
      /** Payment-side deduction (Kaufland "Tichet de ambalaje"), positive. */
      voucherBani: BaniSchema.min(0).optional(),
      /** Amount actually paid (grandTotal - voucher). */
      paidBani: BaniSchema.optional(),
      vat: z.array(VatTotalSchema).optional(),
    }),
    lines: z.array(ParsedLineSchema),
    meta: z.strictObject({
      engine: ExtractionEngineSchema,
      /** Parser id, e.g. 'kaufland'. */
      parser: NonEmptyTextSchema,
      /** Parser semver. */
      parserVersion: SemverSchema,
      /** 0..1 overall. */
      confidence: UnitIntervalSchema.optional(),
      warnings: z.array(ParseWarningSchema),
    }),
  })
  .superRefine((receipt, ctx) => {
    let previous = -1;
    receipt.lines.forEach((line, index) => {
      if (line.idx <= previous) {
        ctx.addIssue({
          code: 'custom',
          message: 'Line idx must be strictly increasing',
          path: ['lines', index, 'idx'],
        });
      }
      previous = line.idx;
    });

    const knownIdx = new Set(receipt.lines.map((line) => line.idx));
    receipt.meta.warnings.forEach((warning, index) => {
      if (warning.lineIdx !== undefined && !knownIdx.has(warning.lineIdx)) {
        ctx.addIssue({
          code: 'custom',
          message: `Warning points at line ${warning.lineIdx}, which does not exist`,
          path: ['meta', 'warnings', index, 'lineIdx'],
        });
      }
    });
  });
export type ParsedReceipt = z.infer<typeof ParsedReceiptSchema>;
