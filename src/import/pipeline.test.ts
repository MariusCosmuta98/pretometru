import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSeed, getReceiptWithLines } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { ImportError, type ImportErrorCode } from './errors';
import { sha256Hex } from './hash';
import {
  importReceipt,
  importToDraft,
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS,
  type ImportProgress,
} from './pipeline';
import { clearReviewSessions, getReviewSession } from './session';
import {
  fakeEngines,
  fakeParser,
  OCR_SOURCE,
  PDF_SOURCE,
  pdfFile,
  pngFile,
  sampleReceipt,
  testServices,
  TEST_CLOCK,
  textFile,
} from './testing';
import { makeParsedLine } from '@/parsers/testing';

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  db = await createTestDb();
  await ensureSeed(db);
});
afterEach(clearReviewSessions);

async function failureOf(promise: Promise<unknown>): Promise<ImportError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ImportError) return error;
    throw error;
  }
  throw new Error('Expected the import to fail');
}

describe('importReceipt', () => {
  it('reads a PDF: engine, then the parser with the injected clock, then a draft with the file hash', async () => {
    const engines = fakeEngines();
    const parser = fakeParser(sampleReceipt());
    const file = pdfFile('kaufland.pdf', 'one');

    const { draft, duplicates, session } = await importReceipt(
      testServices(db, { parser, engines }),
      {
        kind: 'file',
        file,
      },
    );

    expect(engines.calls.extractPdfText).toHaveLength(1);
    expect(parser.calls).toEqual([{ source: PDF_SOURCE, now: TEST_CLOCK }]);
    expect(draft).toMatchObject({
      status: 'draft',
      store: { chain: 'kaufland' },
      totalBani: 3945,
      source: {
        kind: 'pdf',
        fileName: 'kaufland.pdf',
        fileHash: await sha256Hex(await file.arrayBuffer()),
      },
      extraction: { engine: 'pdfjs', parser: 'kaufland', version: '1.0.0' },
    });
    expect(draft.lines.map((line) => line.rawName)).toEqual([
      'LAPTE UHT 1,5% 1L',
      'PULPE PUI',
      'SERVETELE UMEDE 120BUC',
      'GARANTIE AMBALAJ',
    ]);
    expect(new Set(draft.lines.map((line) => line.id)).size).toBe(4);
    expect(duplicates).toEqual([]);
    expect(session.original).toBeUndefined();
    // Reading is not saving.
    expect(draft.id).toBeUndefined();
    expect(await db.receipts.count()).toBe(0);
  });

  it('runs OCR on an image, reports its progress and keeps the original for the crops', async () => {
    const engines = fakeEngines();
    const controller = new AbortController();
    const progress: ImportProgress[] = [];
    const file = pngFile('lidl.png');
    const receipt = sampleReceipt({
      meta: { engine: 'tesseract', parser: 'lidl', parserVersion: '1.0.0', warnings: [] },
      lines: [
        makeParsedLine({
          idx: 0,
          unitPriceBani: 599,
          confidence: 0.62,
          bbox: { x: 4, y: 40, w: 300, h: 20 },
          raw: '1 BUC x 5,99',
        }),
      ],
      totals: { grandTotalBani: 599 },
    });

    const { draft, session } = await importReceipt(
      testServices(db, { parser: fakeParser(receipt), engines }),
      { kind: 'file', file },
      { signal: controller.signal, onProgress: (p) => progress.push(p) },
    );

    expect(engines.calls.extractPdfText).toHaveLength(0);
    expect(engines.calls.recognizeImage[0]?.image).toBe(file);
    expect(engines.calls.recognizeImage[0]?.opts?.signal).toBe(controller.signal);
    expect(progress).toContainEqual({ phase: 'extracting', fraction: 0.5 });
    expect(draft.source).toMatchObject({ kind: 'image', fileName: 'lidl.png' });
    expect(session.original).toBe(file);
    const [line] = draft.lines;
    expect(session.lines[line?.id ?? '']).toEqual({
      unitPriceBani: 599,
      confidence: 0.62,
      bbox: { x: 4, y: 40, w: 300, h: 20 },
      raw: '1 BUC x 5,99',
    });
  });

  it('treats pasted text and .txt files alike: no engine, a hash of the text', async () => {
    const engines = fakeEngines();
    const parser = fakeParser(sampleReceipt());
    const services = testServices(db, { parser, engines });
    const text = 'KAUFLAND\nLAPTE 5,99';

    const pasted = await importReceipt(services, { kind: 'text', text });
    const file = await importReceipt(services, { kind: 'file', file: textFile(text, 'bon.txt') });

    expect(parser.calls.map((call) => call.source)).toEqual([
      { kind: 'pasted-text', text },
      { kind: 'pasted-text', text },
    ]);
    expect(engines.calls.extractPdfText).toHaveLength(0);
    expect(pasted.draft.source).toEqual({
      kind: 'text',
      fileHash: await sha256Hex(new TextEncoder().encode(text)),
    });
    expect(file.draft.source).toMatchObject({ kind: 'text', fileName: 'bon.txt' });
  });

  it('reports the phases in order', async () => {
    const phases: string[] = [];
    await importToDraft(
      testServices(db, { parser: fakeParser(sampleReceipt()) }),
      { kind: 'file', file: pdfFile() },
      { onProgress: ({ phase }) => phases.push(phase) },
    );
    expect(phases).toEqual(['reading', 'extracting', 'parsing', 'checking', 'saving']);
  });

  describe('duplicates', () => {
    it('warns when the same file, or the same store, day and total, is already stored', async () => {
      const services = testServices(db, { parser: fakeParser(sampleReceipt()) });
      const first = await importToDraft(services, { kind: 'file', file: pdfFile('a.pdf', 'one') });
      expect(first.duplicates).toEqual([]);

      const sameFile = await importReceipt(services, {
        kind: 'file',
        file: pdfFile('copy.pdf', 'one'),
      });
      expect(sameFile.duplicates.map((receipt) => receipt.id)).toEqual([first.saved.receipt.id]);
      expect(sameFile.draft.extraction.warnings.map((warning) => warning.code)).toContain(
        'DUPLICATE',
      );

      const sameDayAndTotal = await importReceipt(services, {
        kind: 'file',
        file: pdfFile('other.pdf', 'two'),
      });
      expect(sameDayAndTotal.duplicates).toHaveLength(1);

      const differentTotal = await importReceipt(
        testServices(db, {
          parser: fakeParser(sampleReceipt({ totals: { grandTotalBani: 4000 } })),
        }),
        { kind: 'file', file: pdfFile('third.pdf', 'three') },
      );
      expect(differentTotal.duplicates).toEqual([]);
    });
  });

  describe('failures', () => {
    const services = () => testServices(db, { parser: fakeParser(sampleReceipt()) });
    const codeOf = async (input: Parameters<typeof importReceipt>[1]) =>
      (await failureOf(importReceipt(services(), input))).code;

    it('rejects input that cannot be a receipt', async () => {
      const cases: Array<[ImportErrorCode, Parameters<typeof importReceipt>[1]]> = [
        ['EMPTY_INPUT', { kind: 'file', file: new File([], 'bon.pdf') }],
        ['EMPTY_INPUT', { kind: 'text', text: '  \n ' }],
        ['EMPTY_INPUT', { kind: 'file', file: textFile('   ') }],
        [
          'UNSUPPORTED_FORMAT',
          {
            kind: 'file',
            file: new File(['PK\u0003\u0004'], 'a.zip', { type: 'application/zip' }),
          },
        ],
        [
          'FILE_TOO_LARGE',
          {
            kind: 'file',
            file: Object.defineProperty(pdfFile(), 'size', { value: MAX_FILE_BYTES + 1 }),
          },
        ],
        ['FILE_TOO_LARGE', { kind: 'text', text: 'x'.repeat(MAX_TEXT_CHARS + 1) }],
      ];
      for (const [code, input] of cases) expect(await codeOf(input)).toBe(code);
    });

    it('says so when the engine finds no text or the parser finds no line', async () => {
      const noPdfText = testServices(db, {
        engines: fakeEngines({
          pdf: { kind: 'pdf-text', pages: [{ width: 1, height: 1, items: [] }] },
        }),
      });
      expect(
        (await failureOf(importReceipt(noPdfText, { kind: 'file', file: pdfFile() }))).code,
      ).toBe('NO_TEXT');

      const noOcrText = testServices(db, {
        engines: fakeEngines({ image: { ...OCR_SOURCE, text: ' ', lines: [] } }),
      });
      expect(
        (await failureOf(importReceipt(noOcrText, { kind: 'file', file: pngFile() }))).code,
      ).toBe('NO_TEXT');

      const noLines = testServices(db, { parser: fakeParser(sampleReceipt({ lines: [] })) });
      expect((await failureOf(importReceipt(noLines, { kind: 'text', text: 'abc' }))).code).toBe(
        'NOTHING_RECOGNIZED',
      );
    });

    it('wraps engine failures and lets "not wired in" through', async () => {
      const boom = new Error('boom');
      const failing = testServices(db, {
        engines: fakeEngines({}, { extractPdfText: () => Promise.reject(boom) }),
      });
      const failure = await failureOf(importReceipt(failing, { kind: 'file', file: pdfFile() }));
      expect(failure.code).toBe('EXTRACTION_FAILED');
      expect(failure.cause).toBe(boom);

      const missing = new ImportError('ENGINE_UNAVAILABLE', 'not wired in');
      const unavailable = testServices(db, {
        engines: fakeEngines({}, { recognizeImage: () => Promise.reject(missing) }),
      });
      expect(await failureOf(importReceipt(unavailable, { kind: 'file', file: pngFile() }))).toBe(
        missing,
      );
    });

    it('stops when cancelled, before or during the engine', async () => {
      const before = new AbortController();
      before.abort();
      expect(
        (
          await failureOf(
            importReceipt(services(), { kind: 'file', file: pdfFile() }, { signal: before.signal }),
          )
        ).code,
      ).toBe('CANCELLED');

      const during = new AbortController();
      const engines = fakeEngines(
        {},
        {
          recognizeImage: () => {
            during.abort();
            return Promise.reject(new DOMException('aborted', 'AbortError'));
          },
        },
      );
      const cancelled = importReceipt(
        testServices(db, { engines }),
        { kind: 'file', file: pngFile() },
        { signal: during.signal },
      );
      expect((await failureOf(cancelled)).code).toBe('CANCELLED');
      expect(await db.receipts.count()).toBe(0);
    });
  });
});

describe('importToDraft', () => {
  it('saves a draft the review screen can open, with derived unit prices, and keeps the image in memory', async () => {
    const file = pngFile('lidl.png');
    const outcome = await importToDraft(testServices(db, { parser: fakeParser(sampleReceipt()) }), {
      kind: 'file',
      file,
    });

    const stored = await getReceiptWithLines(db, outcome.saved.receipt.id);
    expect(stored?.receipt).toMatchObject({
      status: 'draft',
      totalBani: 3945,
      source: { kind: 'image', fileName: 'lidl.png' },
      extraction: { parser: 'kaufland' },
    });
    expect(stored?.lines.map((line) => line.rawName)).toHaveLength(4);
    expect(getReviewSession(outcome.saved.receipt.id)?.original).toBe(file);
    // The file itself never reaches the database.
    expect(JSON.stringify(await db.receipts.toArray())).not.toContain('PNG');
  });
});
