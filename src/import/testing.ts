/**
 * Test-only fakes for the import ports: engines, a parser backed by the real validation, an
 * in-memory alias catalog and deterministic services. Never import this from application code.
 */
import {
  createIdGenerator,
  normalizeName,
  type Chain,
  type ParsedReceipt,
  type Product,
  type ReceiptSource,
} from '@/domain';
import { validateReceipt } from '@/parsers';
import { makeParsedLine, makeParsedReceipt } from '@/parsers/testing';
import { createRecord, type PretometruDB } from '@/storage';
import type {
  AiPort,
  AiReadPhase,
  BoundingBox,
  CatalogPort,
  EnginePort,
  LineMapping,
  MappingChoice,
  NewProductInput,
  OcrTextSource,
  PackChoice,
  ParserPort,
  PdfTextSource,
  RecognizeOptions,
} from './ports';
import type { ImportServices } from './services';

/** 2026-11-20 12:00 in Bucharest (the day the Lidl sample "29/12/2026" is still in the future). */
export const TEST_CLOCK = new Date('2026-11-20T10:00:00.000Z');

export function testNow(): Date {
  return new Date(TEST_CLOCK);
}

/**
 * One monotonic, deterministic id source per test file: receipts, lines and drafts built by
 * different calls never collide (ids restart only with a new test file).
 */
export const testIds: () => string = createIdGenerator({
  now: () => 1_800_000_000_000,
  randomBytes: (length) => new Uint8Array(length),
});

export const PDF_SOURCE: PdfTextSource = {
  kind: 'pdf-text',
  pages: [{ width: 595, height: 842, items: [{ str: 'KAUFLAND', x: 10, y: 800, w: 60, h: 10 }] }],
};

export const OCR_SOURCE: OcrTextSource = {
  kind: 'ocr-text',
  text: 'LIDL\nLAPTE 1L 5,99 A',
  confidence: 80,
  imageSize: { w: 800, h: 1200 },
};

export function pdfFile(name = 'bon.pdf', body = 'bon'): File {
  return new File([`%PDF-1.7\n${body}`], name, { type: 'application/pdf' });
}

export function pngFile(name = 'bon.png', body = 'bon'): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47]), body], name, { type: 'image/png' });
}

export function textFile(text: string, name = 'bon.txt'): File {
  return new File([text], name, { type: 'text/plain' });
}

/**
 * A receipt in the shape the Kaufland parser produces: a counted line, a weighed one, a line with
 * a pack size and an EAN, and a deposit. Σ lines = 39,45 = the printed total; dated before TEST_CLOCK.
 */
export function sampleReceipt(overrides: Partial<ParsedReceipt> = {}): ParsedReceipt {
  return makeParsedReceipt({
    lines: [
      makeParsedLine({
        idx: 0,
        rawName: 'LAPTE UHT 1,5% 1L',
        qty: 2,
        unitPriceBani: 599,
        lineTotalBani: 1198,
        vatRate: 11,
        vatClass: 'C',
        storeCategoryHint: 'Mopro/Brânză/Ouă',
        pack: { qty: 1, unit: 'l' },
      }),
      makeParsedLine({
        idx: 1,
        rawName: 'PULPE PUI',
        qty: 0.92,
        qtyUnit: 'kg',
        lineTotalBani: 2299,
        vatRate: 11,
        vatClass: 'C',
      }),
      makeParsedLine({
        idx: 2,
        rawName: 'SERVETELE UMEDE 120BUC',
        ean: '5941234567890',
        lineTotalBani: 398,
        vatRate: 21,
        vatClass: 'B',
        pack: { qty: 120, unit: 'buc' },
      }),
      makeParsedLine({
        idx: 3,
        rawName: 'GARANTIE AMBALAJ',
        kind: 'deposit',
        lineTotalBani: 50,
        vatRate: 0,
        vatClass: 'D',
      }),
    ],
    totals: { grandTotalBani: 3945 },
    ...overrides,
  });
}

export interface FakeEngines extends EnginePort {
  calls: {
    extractPdfText: ArrayBuffer[];
    recognizeImage: Array<{ image: Blob; opts: RecognizeOptions | undefined }>;
    cropRegion: Array<{
      image: Blob;
      bbox: BoundingBox;
      options: { padding?: number } | undefined;
    }>;
  };
}

/**
 * `sources.image` may list one source per OCR pass (the last one repeats): the first answers the
 * normal pass, the second the retry at another scale.
 */
export function fakeEngines(
  sources: { pdf?: PdfTextSource; image?: OcrTextSource | OcrTextSource[] } = {},
  behaviour: Partial<EnginePort> = {},
): FakeEngines {
  const calls: FakeEngines['calls'] = { extractPdfText: [], recognizeImage: [], cropRegion: [] };
  const passes = Array.isArray(sources.image) ? sources.image : [sources.image ?? OCR_SOURCE];
  return {
    calls,
    extractPdfText:
      behaviour.extractPdfText ??
      ((data) => {
        calls.extractPdfText.push(data);
        return Promise.resolve(sources.pdf ?? PDF_SOURCE);
      }),
    recognizeImage:
      behaviour.recognizeImage ??
      ((image, opts) => {
        const pass = calls.recognizeImage.length;
        calls.recognizeImage.push({ image, opts });
        opts?.onProgress?.(0.5);
        opts?.onProgress?.(1);
        return Promise.resolve(passes[Math.min(pass, passes.length - 1)] ?? OCR_SOURCE);
      }),
    cropRegion:
      behaviour.cropRegion ??
      ((image, bbox, options) => {
        calls.cropRegion.push({ image, bbox, options });
        return Promise.resolve(new Blob(['crop'], { type: 'image/png' }));
      }),
  };
}

export interface FakeParser extends ParserPort {
  calls: Array<{ source: ReceiptSource; now: Date }>;
}

/**
 * Answers every source with `receipt`, finished like `parseReceipt` does: the real arithmetic
 * validation is appended to the parser's own warnings.
 */
export function fakeParser(receipt: ParsedReceipt): FakeParser {
  const calls: FakeParser['calls'] = [];
  return {
    calls,
    parseReceipt: (source, opts) => {
      calls.push({ source, now: opts.now });
      const warnings = [...receipt.meta.warnings];
      for (const warning of validateReceipt(receipt, opts)) {
        if (!warnings.some((w) => w.code === warning.code && w.lineIdx === warning.lineIdx)) {
          warnings.push(warning);
        }
      }
      return { ...receipt, meta: { ...receipt.meta, warnings } };
    },
    validateReceipt,
  };
}

export interface FakeCatalog extends CatalogPort {
  /** `rememberMappings` calls, in order. */
  remembered: Array<{ chain: Chain; choices: MappingChoice[] }>;
  /** Fuzzy suggestions to return for a printed name (the real fuzzy matcher is not in yet). */
  suggest: Map<string, Product[]>;
}

const aliasKey = (chain: Chain, rawName: string) => `${chain}|${normalizeName(rawName)}`;

/** An alias-only catalog kept in memory; products live in the test database. */
export function fakeCatalog(): FakeCatalog {
  const aliases = new Map<string, { productId: string; pack?: PackChoice }>();
  const suggest = new Map<string, Product[]>();
  const remembered: FakeCatalog['remembered'] = [];

  return {
    remembered,
    suggest,
    async suggestMappings(db, receipt) {
      const mappings: LineMapping[] = [];
      for (const line of receipt.lines) {
        const alias = aliases.get(aliasKey(receipt.chain, line.rawName));
        const product = alias ? await db.products.get(alias.productId) : undefined;
        if (alias && product) {
          mappings.push({
            productId: product.id,
            categoryId: product.categoryId,
            ...(alias.pack && line.pack === undefined ? { pack: alias.pack } : {}),
            via: 'alias',
            candidates: [{ product, score: 1 }],
          });
          continue;
        }
        const candidates = (suggest.get(line.rawName) ?? []).map((candidate, rank) => ({
          product: candidate,
          score: 0.8 - rank / 10,
        }));
        mappings.push({ via: candidates.length > 0 ? 'fuzzy' : 'none', candidates });
      }
      return mappings;
    },
    async searchProducts(db, query, limit = 20) {
      const wanted = normalizeName(query);
      const all = await db.products.filter((p) => p.deletedAt === undefined).toArray();
      return all.filter((p) => normalizeName(p.name).includes(wanted)).slice(0, limit);
    },
    createProduct(db: PretometruDB, input: NewProductInput, context) {
      return createRecord(
        db.products,
        {
          name: input.name.trim(),
          categoryId: input.categoryId,
          baseUnit: input.baseUnit,
          ...(input.brand ? { brand: input.brand } : {}),
          ...(input.ean ? { ean: input.ean } : {}),
        },
        context,
      );
    },
    rememberMappings(_db, chain, choices) {
      remembered.push({ chain, choices: [...choices] });
      for (const choice of choices) {
        aliases.set(aliasKey(chain, choice.rawName), {
          productId: choice.productId,
          ...(choice.pack ? { pack: choice.pack } : {}),
        });
      }
      return Promise.resolve();
    },
  };
}

export interface FakeAi extends AiPort {
  /** What `isEnabled` answers: the feature is off unless a test switches it on. */
  enabled: boolean;
  /** The photos that were sent, in order. */
  sent: Blob[];
  /**
   * What a reading answers: a receipt, an error to reject with, or a function (to wait for the
   * abort signal, say). The phases are reported first, as the real one does.
   */
  answer:
    | ParsedReceipt
    | Error
    | ((image: Blob, options: { signal?: AbortSignal }) => ParsedReceipt | Promise<ParsedReceipt>);
}

/** The Gemini port, in memory: off, and nothing is ever sent anywhere. */
export function fakeAi(init: Partial<Pick<FakeAi, 'enabled' | 'answer'>> = {}): FakeAi {
  const fake: FakeAi = {
    enabled: init.enabled ?? false,
    sent: [],
    answer: init.answer ?? new Error('No answer was prepared for the Gemini reading'),
    isEnabled: () => Promise.resolve(fake.enabled),
    readReceipt: async (image, options = {}) => {
      fake.sent.push(image);
      const phases: AiReadPhase[] = ['preparing', 'sending'];
      for (const phase of phases) options.onPhase?.(phase);
      const { answer } = fake;
      if (answer instanceof Error) throw answer;
      return typeof answer === 'function'
        ? answer(image, options.signal ? { signal: options.signal } : {})
        : answer;
    },
  };
  return fake;
}

/** Deterministic services over a test database; pass what a test wants to observe or replace. */
export function testServices(
  db: PretometruDB,
  overrides: Partial<ImportServices> = {},
): ImportServices {
  return {
    getDb: () => Promise.resolve(db),
    parser: fakeParser(makeParsedReceipt()),
    engines: fakeEngines(),
    catalog: fakeCatalog(),
    ai: fakeAi(),
    now: testNow,
    newId: testIds,
    ...overrides,
  };
}
