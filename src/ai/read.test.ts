import { getFixture } from '@fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PretometruDB } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { DEFAULT_MODEL, saveApiKey, setAiEnabled, setAiModel } from './config';
import { AiError } from './errors';
import { googleError, MockGemini } from './mock-gemini';
import { readReceiptWithGemini } from './read';
import { resetAiServices, setAiServices } from './services';
import {
  answerFromReceipt,
  FAKE_KEY,
  fakePhoto,
  fakePreparedImage,
  TEST_NOW,
  wireMockGemini,
} from './testing';
import type { AiPhase } from './types';

let db: PretometruDB;
let mock: MockGemini;
beforeEach(async () => {
  db = await createTestDb();
  mock = new MockGemini({ keys: [FAKE_KEY] }).addModel('gemini-3.6-flash');
  wireMockGemini(db, mock);
});
afterEach(async () => {
  mock.dispose();
  resetAiServices();
  await db.delete();
});

async function switchOn(model?: string): Promise<void> {
  await saveApiKey(db, FAKE_KEY);
  if (model) await setAiModel(db, model);
  await setAiEnabled(db, true);
}

async function failure(run: () => Promise<unknown>): Promise<AiError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AiError) {
      // Whatever went wrong, the key is not in the words of the error.
      expect(`${error.message} ${error.detail ?? ''}`).not.toContain(FAKE_KEY);
      return error;
    }
    throw error;
  }
  throw new Error('It did not fail');
}

/** The services of `wireMockGemini`, with a spy on the photo preparation. */
function spyOnPreparation(options: { fails?: boolean; online?: boolean } = {}): { calls: number } {
  const spy = { calls: 0 };
  setAiServices({
    getDb: () => Promise.resolve(db),
    fetch: mock.fetch,
    now: () => TEST_NOW,
    isOnline: () => options.online ?? true,
    prepareImage: () => {
      spy.calls += 1;
      return options.fails
        ? Promise.reject(new Error('decode failed'))
        : Promise.resolve(fakePreparedImage());
    },
  });
  return spy;
}

describe('while the feature is off, which is how it starts', () => {
  it('sends nothing and does not even prepare the photo: with no key, and with a key that is not switched on', async () => {
    const preparation = spyOnPreparation();
    await expect(failure(() => readReceiptWithGemini(fakePhoto()))).resolves.toMatchObject({
      code: 'NO_KEY',
    });

    await saveApiKey(db, FAKE_KEY);
    await expect(failure(() => readReceiptWithGemini(fakePhoto()))).resolves.toMatchObject({
      code: 'NOT_ENABLED',
    });

    expect(mock.requests).toEqual([]);
    expect(preparation.calls).toBe(0);
  });

  it('stops being possible when the key is removed', async () => {
    await switchOn();
    mock.answer = answerFromReceipt(getFixture('mega-image-2026-11-03').expected);
    await expect(readReceiptWithGemini(fakePhoto())).resolves.toBeDefined();

    const { removeApiKey } = await import('./config');
    await removeApiKey(db);
    await expect(failure(() => readReceiptWithGemini(fakePhoto()))).resolves.toMatchObject({
      code: 'NO_KEY',
    });
    expect(mock.generates).toHaveLength(1);
  });
});

describe('a reading', () => {
  it('sends the prepared photo once and returns the receipt the answer describes', async () => {
    await switchOn();
    const fixture = getFixture('mega-image-2026-11-03');
    mock.answer = answerFromReceipt(fixture.expected);
    const phases: AiPhase[] = [];

    const receipt = await readReceiptWithGemini(fakePhoto(), {
      onPhase: (phase) => phases.push(phase),
    });

    expect(phases).toEqual(['preparing', 'sending']);
    expect(mock.generates).toHaveLength(1);
    expect(mock.generates[0]?.model).toBe(DEFAULT_MODEL);
    expect(receipt.meta).toMatchObject({ engine: 'gemini', parser: DEFAULT_MODEL });
    expect(receipt.lines.map((line) => [line.rawName, line.lineTotalBani])).toEqual(
      fixture.expected.lines.map((line) => [line.rawName, line.lineTotalBani]),
    );
    expect(receipt.totals.grandTotalBani).toBe(fixture.expected.totals.grandTotalBani);
    expect(receipt.meta.warnings).toEqual([]);
    expect(mock.violations).toEqual([]);
  });

  it('uses the model that is set', async () => {
    await switchOn('gemini-3.6-flash');
    mock.answer = answerFromReceipt(getFixture('lidl-2026-12-29').expected);
    const receipt = await readReceiptWithGemini(fakePhoto());
    expect(mock.requests[0]?.path).toBe('/v1beta/models/gemini-3.6-flash:generateContent');
    expect(receipt.meta.parser).toBe('gemini-3.6-flash');
    // The Lidl receipt is dated after the test clock: the review will ask about it.
    expect(receipt.meta.warnings.map((warning) => warning.code)).toEqual(['FUTURE_DATE']);
  });

  it('hands a wrong reading to the review as warnings, not as an error', async () => {
    await switchOn();
    const truth = getFixture('mega-image-2026-11-03').expected;
    // The 17,89 of the first row read as 17,19: the lines no longer add up to the printed total.
    mock.answer = answerFromReceipt({
      ...truth,
      lines: truth.lines.map((line, index) =>
        index === 0 ? { ...line, lineTotalBani: 1719 } : line,
      ),
    });
    const receipt = await readReceiptWithGemini(fakePhoto());
    expect(receipt.meta.warnings.map((warning) => warning.code)).toEqual(['SUM_MISMATCH']);
  });
});

describe('what stops a reading', () => {
  it('is no connection: nothing is prepared or sent', async () => {
    await switchOn();
    const preparation = spyOnPreparation({ online: false });
    await expect(failure(() => readReceiptWithGemini(fakePhoto()))).resolves.toMatchObject({
      code: 'OFFLINE',
    });
    expect(preparation.calls).toBe(0);
    expect(mock.requests).toEqual([]);
  });

  it('is a photo that cannot be prepared: it is never sent as it is', async () => {
    await switchOn();
    spyOnPreparation({ fails: true });
    await expect(failure(() => readReceiptWithGemini(fakePhoto()))).resolves.toMatchObject({
      code: 'IMAGE_UNREADABLE',
    });
    expect(mock.requests).toEqual([]);
  });

  it('is a cancellation, also while the answer is awaited', async () => {
    await switchOn();
    const controller = new AbortController();
    mock.hold(/generateContent/);
    const pending = failure(() =>
      readReceiptWithGemini(fakePhoto(), {
        signal: controller.signal,
        onPhase: (phase) => phase === 'sending' && controller.abort(),
      }),
    );
    await expect(pending).resolves.toMatchObject({ code: 'CANCELLED' });

    const early = new AbortController();
    early.abort();
    await expect(
      failure(() => readReceiptWithGemini(fakePhoto(), { signal: early.signal })),
    ).resolves.toMatchObject({ code: 'CANCELLED' });
  });

  it('is an error of Google: the photo is sent once, never again by itself', async () => {
    await switchOn();
    mock.failNext(
      /generateContent/,
      googleError(503, 'UNAVAILABLE', 'The model is overloaded.'),
      5,
    );
    await expect(failure(() => readReceiptWithGemini(fakePhoto()))).resolves.toMatchObject({
      code: 'SERVER',
    });
    expect(
      mock.requests.filter((request) => request.path.endsWith(':generateContent')),
    ).toHaveLength(1);
  });

  it('is an answer that cannot be used: nothing reaches the caller', async () => {
    await switchOn();
    for (const [answer, code] of [
      ['Sorry, I can not help with that.', 'MALFORMED'],
      [JSON.stringify({ lines: [] }), 'NO_LINES'],
      [JSON.stringify({ lines: [{ name: 'X', total: 1e12 }] }), 'MALFORMED'],
    ] as const) {
      mock.answer = answer;
      await expect(
        failure(() => readReceiptWithGemini(fakePhoto())),
        answer,
      ).resolves.toMatchObject({ code });
    }
  });
});
