import { getFixture, sourceOf } from '@fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSeed } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { defaultParser } from './engines';
import { ImportError } from './errors';
import { importReceipt, importToDraft, type ImportPhase, type ImportProgress } from './pipeline';
import type { OcrTextSource } from './ports';
import { SECOND_PASS_SCALE } from './second-pass';
import { clearReviewSessions, getReviewSession } from './session';
import {
  fakeEngines,
  fakeParser,
  pdfFile,
  pngFile,
  sampleReceipt,
  testServices,
  textFile,
} from './testing';

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  db = await createTestDb();
  await ensureSeed(db);
});
afterEach(clearReviewSessions);

/** The OCR text of a real fixture and the case clock it is dated against. */
function ocrFixture(id: string) {
  const fixture = getFixture(id);
  const { source, expected } = sourceOf(fixture, 'ocr-text');
  const { source: pasted } = sourceOf(fixture, 'pasted-text');
  return { source, expected, pasted: pasted.text, now: () => new Date(fixture.now) };
}

/** The same OCR reading with one printed row lost, as a scale that misses a row would. */
function withoutRow(source: OcrTextSource, pattern: RegExp): OcrTextSource {
  const rows = source.text.split('\n');
  const index = rows.findIndex((row) => pattern.test(row));
  if (index < 0) throw new Error(`No row matches ${String(pattern)}`);
  return {
    ...source,
    text: rows.filter((_, i) => i !== index).join('\n'),
    ...(source.lines ? { lines: source.lines.filter((_, i) => i !== index) } : {}),
  };
}

/** What a reading at another scale that got every price right would give: the corrected text. */
function cleanReading(source: OcrTextSource, text: string): OcrTextSource {
  const { lines: _lines, ...rest } = source;
  return { ...rest, text };
}

const photo = () => ({ kind: 'file', file: pngFile('bon.png') }) as const;
const codes = (draft: { extraction: { warnings: Array<{ code: string }> } }) =>
  draft.extraction.warnings.map((warning) => warning.code);

describe('a second OCR pass (real parsers behind the fake engine)', () => {
  it('costs nothing when the first reading is clean', async () => {
    const lidl = ocrFixture('lidl-2026-12-29');
    const engines = fakeEngines({ image: lidl.source });
    const phases: ImportPhase[] = [];

    const { draft } = await importReceipt(
      testServices(db, { parser: defaultParser, engines, now: lidl.now }),
      photo(),
      { onProgress: ({ phase }) => phases.push(phase) },
    );

    expect(engines.calls.recognizeImage).toHaveLength(1);
    expect(engines.calls.recognizeImage[0]?.opts?.preprocessing).toBeUndefined();
    expect(phases).not.toContain('rereading');
    // A future date and repaired digits are for the user, not for the OCR.
    expect(codes(draft)).toEqual(expect.arrayContaining(['FUTURE_DATE', 'REPAIRED_DIGITS']));
  });

  it('keeps the second reading when it finds the date the first one lost (Lidl)', async () => {
    const lidl = ocrFixture('lidl-2026-12-29');
    const engines = fakeEngines({ image: [withoutRow(lidl.source, /^DATA:/), lidl.source] });
    const controller = new AbortController();

    const { draft } = await importReceipt(
      testServices(db, { parser: defaultParser, engines, now: lidl.now }),
      photo(),
      { signal: controller.signal },
    );

    expect(engines.calls.recognizeImage).toHaveLength(2);
    expect(engines.calls.recognizeImage[1]?.opts).toMatchObject({
      preprocessing: { scale: SECOND_PASS_SCALE },
      signal: controller.signal,
    });
    expect(SECOND_PASS_SCALE).toBe(3);
    expect(draft.purchasedAt).toBe(lidl.expected.purchasedAt);
    expect(codes(draft)).not.toContain('MISSING_DATE');
    expect(codes(draft)).toContain('FUTURE_DATE');
    expect(draft.lines).toHaveLength(lidl.expected.lines.length);
  });

  it('keeps the second reading when only it adds up to the printed total (Mega Image)', async () => {
    const mega = ocrFixture('mega-image-2026-11-03');
    const engines = fakeEngines({ image: [mega.source, cleanReading(mega.source, mega.pasted)] });

    const { draft } = await importReceipt(
      testServices(db, { parser: defaultParser, engines, now: mega.now }),
      photo(),
    );

    expect(engines.calls.recognizeImage).toHaveLength(2);
    expect(codes(draft)).toEqual([]);
    expect(draft.totalBani).toBe(mega.expected.totals.grandTotalBani);
    expect(draft.lines.reduce((sum, line) => sum + line.lineTotalBani, 0)).toBe(draft.totalBani);
    expect(draft.lines.map((line) => line.rawName)).toEqual(
      expect.arrayContaining(['ALWAYS ULTRA 16BUC']),
    );
  });

  it('keeps the first reading when the second one is no better', async () => {
    const mega = ocrFixture('mega-image-2026-11-03');
    const services = (second: OcrTextSource) =>
      testServices(db, {
        parser: defaultParser,
        engines: fakeEngines({ image: [mega.source, second] }),
        now: mega.now,
      });

    // The same sum mismatch again, or the same one plus a lost date: the first reading stays.
    for (const second of [mega.source, withoutRow(mega.source, /DAT/)]) {
      const { draft } = await importReceipt(services(second), photo());
      expect(codes(draft)).toEqual(['SUM_MISMATCH']);
      expect(draft.purchasedAt).toBe(mega.expected.purchasedAt);
    }
  });

  it('keeps the first reading when the second pass fails or reads nothing', async () => {
    const mega = ocrFixture('mega-image-2026-11-03');
    const read = (second: () => Promise<OcrTextSource>) => {
      let calls = 0;
      const engines = fakeEngines(
        {},
        { recognizeImage: () => (calls++ === 0 ? Promise.resolve(mega.source) : second()) },
      );
      return importReceipt(
        testServices(db, { parser: defaultParser, engines, now: mega.now }),
        photo(),
      );
    };

    const failed = await read(() => Promise.reject(new Error('worker crashed')));
    expect(codes(failed.draft)).toEqual(['SUM_MISMATCH']);

    const empty = await read(() => Promise.resolve({ ...mega.source, text: ' ', lines: [] }));
    expect(codes(empty.draft)).toEqual(['SUM_MISMATCH']);
  });

  it('shows the second pass as one extra status, with progress that never goes back', async () => {
    const mega = ocrFixture('mega-image-2026-11-03');
    const engines = fakeEngines({ image: [mega.source, cleanReading(mega.source, mega.pasted)] });
    const progress: ImportProgress[] = [];

    await importToDraft(
      testServices(db, { parser: defaultParser, engines, now: mega.now }),
      photo(),
      { onProgress: (p) => progress.push(p) },
    );

    const phases = progress
      .map(({ phase }) => phase)
      .filter((phase, i, all) => phase !== all[i - 1]);
    expect(phases).toEqual(['reading', 'extracting', 'parsing', 'rereading', 'checking', 'saving']);
    for (const phase of ['extracting', 'rereading'] as const) {
      const fractions = progress.flatMap((p) => (p.phase === phase ? [p.fraction ?? 0] : []));
      expect(fractions.length).toBeGreaterThan(0);
      expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    }
  });

  it('stops during the second pass when cancelled, and saves nothing', async () => {
    const mega = ocrFixture('mega-image-2026-11-03');
    const controller = new AbortController();
    let calls = 0;
    const engines = fakeEngines(
      {},
      {
        recognizeImage: (_image, opts) => {
          if (calls++ === 0) return Promise.resolve(mega.source);
          controller.abort();
          expect(opts?.signal).toBe(controller.signal);
          return Promise.reject(new DOMException('aborted', 'AbortError'));
        },
      },
    );

    const cancelled = importToDraft(
      testServices(db, { parser: defaultParser, engines, now: mega.now }),
      photo(),
      { signal: controller.signal },
    );

    await expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(calls).toBe(2);
    expect(await db.receipts.count()).toBe(0);
  });

  it('does not start the second pass once the user has cancelled', async () => {
    const mega = ocrFixture('mega-image-2026-11-03');
    const controller = new AbortController();
    const engines = fakeEngines({ image: mega.source });

    const cancelled = importReceipt(
      testServices(db, { parser: defaultParser, engines, now: mega.now }),
      photo(),
      {
        signal: controller.signal,
        onProgress: ({ phase }) => {
          if (phase === 'parsing') controller.abort();
        },
      },
    );

    await expect(cancelled).rejects.toBeInstanceOf(ImportError);
    expect(engines.calls.recognizeImage).toHaveLength(1);
  });

  it('is for photos only: a PDF or pasted text with a sum mismatch is read once', async () => {
    const mismatch = sampleReceipt({ totals: { grandTotalBani: 4000 } });
    const engines = fakeEngines();
    const services = testServices(db, { parser: fakeParser(mismatch), engines });
    const phases: ImportPhase[] = [];
    const onProgress = ({ phase }: ImportProgress) => phases.push(phase);

    const pdf = await importReceipt(services, { kind: 'file', file: pdfFile() }, { onProgress });
    const text = await importReceipt(services, { kind: 'text', text: 'KAUFLAND' }, { onProgress });
    const txt = await importReceipt(
      services,
      { kind: 'file', file: textFile('KAUFLAND\nLAPTE') },
      { onProgress },
    );

    for (const { draft } of [pdf, text, txt]) expect(codes(draft)).toContain('SUM_MISMATCH');
    expect(engines.calls.extractPdfText).toHaveLength(1);
    expect(engines.calls.recognizeImage).toHaveLength(0);
    expect(phases).not.toContain('rereading');
  });

  it('keeps the original photo for the crops of whichever reading wins', async () => {
    const lidl = ocrFixture('lidl-2026-12-29');
    const engines = fakeEngines({ image: [withoutRow(lidl.source, /^DATA:/), lidl.source] });
    const file = pngFile('lidl.png');

    const { saved } = await importToDraft(
      testServices(db, { parser: defaultParser, engines, now: lidl.now }),
      { kind: 'file', file },
    );

    expect(getReviewSession(saved.receipt.id)?.original).toBe(file);
    expect(engines.calls.recognizeImage.map((call) => call.image)).toEqual([file, file]);
  });
});
