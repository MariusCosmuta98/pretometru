// @vitest-environment jsdom
import { getFixture } from '@fixtures';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetAiServices, saveApiKey, setAiEnabled } from '@/ai';
import { candidateReply, googleError, MockGemini } from '@/ai/mock-gemini';
import { answerFromReceipt, FAKE_KEY, wireMockGemini } from '@/ai/testing';
import type { ParsedReceipt } from '@/domain';
import { clearReviewSessions } from '@/import';
import { getReceiptWithLines, listActive } from '@/storage';
import { appHarness, click, expectFocus, field, goTo, importPdf, importPhoto } from './testing';

const app = appHarness();
const truth = getFixture('mega-image-2026-11-03').expected;

let mock: MockGemini;
beforeEach(() => {
  mock = new MockGemini({ keys: [FAKE_KEY] });
});
afterEach(() => {
  mock.dispose();
  resetAiServices();
  // Nothing the review sent may be something a browser would have blocked.
  expect(mock.violations).toEqual([]);
});

/** The OCR reading of the Mega Image photo got the first price wrong: 17,19 instead of 17,89. */
const misread = (expected: ParsedReceipt): ParsedReceipt => ({
  ...expected,
  lines: expected.lines.map((line, index) =>
    index === 0 ? { ...line, lineTotalBani: 1719 } : line,
  ),
});

/** A photo imported with the OCR engine, whose reading is wrong, reviewed with the AI feature on or off. */
async function reviewPhoto(options: { enabled?: boolean; key?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  if (enabled || options.key) await saveApiKey(app.db, FAKE_KEY);
  if (enabled) await setAiEnabled(app.db, true);
  wireMockGemini(app.db, mock);
  mock.answer = answerFromReceipt(truth);

  const installed = app.install('mega-image-2026-11-03', { kind: 'ocr-text', receipt: misread });
  const router = app.renderApp('/adauga');
  await importPhoto(router);
  return { router, ...installed };
}

const askButton = () => screen.queryByRole('button', { name: 'Citește cu AI' });
const total = (line: number) => field(`Total linie (lei), linia ${line}`).value;

/** Opens the confirmation, reads what it says and sends the photo. */
async function readWithAi() {
  click('Citește cu AI');
  await screen.findByRole('dialog', { name: 'Trimiți poza la Gemini?' });
  click('Trimite poza la Gemini');
}

describe('"Citește cu AI" is not there unless the feature is on', () => {
  it('is absent by default, and with a key that was not switched on: nothing is sent', async () => {
    await reviewPhoto({ enabled: false });
    expect(askButton()).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Citire cu AI' })).toBeNull();
    cleanup();
    await app.db.syncState.clear();

    await reviewPhoto({ enabled: false, key: true });
    expect(askButton()).toBeNull();
    expect(mock.requests).toEqual([]);
  });

  it('is offered on a draft read from a photo', async () => {
    await reviewPhoto();
    expect(screen.getByRole('heading', { level: 2, name: 'Citire cu AI' })).toBeTruthy();
    expect(askButton()).toBeTruthy();
    expect(mock.requests).toEqual([]);
  });

  it('is not offered for a PDF, a receipt typed by hand or one that was confirmed', async () => {
    await saveApiKey(app.db, FAKE_KEY);
    await setAiEnabled(app.db, true);
    wireMockGemini(app.db, mock);

    app.install('kaufland-2026-11-07');
    const router = app.renderApp('/adauga');
    await importPdf(router);
    expect(askButton()).toBeNull();

    await goTo(router, '/bonuri/nou');
    await screen.findByRole('heading', { level: 2, name: 'Detalii bon' });
    expect(askButton()).toBeNull();

    app.install('mega-image-2026-11-03', { kind: 'ocr-text', receipt: () => truth });
    await importPhoto(router, 'mega.png', 'mega');
    expect(askButton()).toBeTruthy();
    click('Confirmă bonul');
    expect(await screen.findByText('Bonul a fost confirmat.')).toBeTruthy();
    const confirmed = (await listActive(app.db.receipts)).find(
      (receipt) => receipt.status === 'confirmed',
    );
    await goTo(router, `/bonuri/${confirmed?.id ?? ''}`);
    await screen.findByRole('heading', { level: 2, name: 'Detalii bon' });
    expect(askButton()).toBeNull();
    expect(mock.requests).toEqual([]);
  });
});

describe('the confirmation', () => {
  it('says what is sent and carries the free-tier warning, and sends nothing when the user backs out', async () => {
    await reviewPhoto();
    click('Citește cu AI');

    const dialog = await screen.findByRole('dialog', { name: 'Trimiți poza la Gemini?' });
    const text = dialog.textContent;
    expect(text).toContain('Ce se trimite.');
    expect(text).toContain('micșorată și refăcută ca JPEG');
    expect(text).toContain('numărul cardului sau al cardului de fidelitate');
    expect(text).toContain('Nivelul gratuit.');
    expect(text).toContain('îmbunătățească produsele');
    expect(text).toContain('Spațiul Economic European');
    expect(
      within(dialog).getByRole('link', { name: 'Termenii Gemini API' }).getAttribute('href'),
    ).toBe('https://ai.google.dev/gemini-api/terms');
    await expectFocus(within(dialog).getByRole('button', { name: 'Renunță' }));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Renunță' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(mock.requests).toEqual([]);
    // Escape backs out too.
    click('Citește cu AI');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(mock.requests).toEqual([]);
  });
});

describe('a reading by Gemini', () => {
  it('replaces the reading on screen like any edit: checked again, unsaved, and the old one one button away', async () => {
    await reviewPhoto();
    expect(total(1)).toBe('17,19');
    expect(screen.getByText(/diferență/)).toBeTruthy();
    expect(screen.getByRole('region', { name: /Avertismente/ }).textContent).toContain(
      'Suma liniilor',
    );

    await readWithAi();
    expect(
      await screen.findByText(/Bonul este citit cu Gemini \(gemini-3\.5-flash-lite\)/),
    ).toBeTruthy();

    // The photo went once, as a JPEG, with the key in the header.
    expect(mock.generates).toHaveLength(1);
    expect(mock.generates[0]?.imageMimeType).toBe('image/jpeg');
    expect(mock.requests[0]?.headers['x-goog-api-key']).toBe(FAKE_KEY);

    // The new lines add up: the warning is gone and the sum matches.
    expect(total(1)).toBe('17,89');
    expect(screen.getByText(/se potrivesc/)).toBeTruthy();
    expect(screen.getByRole('region', { name: /Avertismente/ }).textContent).toContain(
      'Nu am găsit nicio problemă',
    );
    expect(screen.getByText(/· citit cu Gemini/)).toBeTruthy();
    expect(
      screen.getByText(/Gemini a citit bonul\. Verifică liniile și suma cu poza/),
    ).toBeTruthy();

    // Nothing was saved by reading: the stored draft still holds the first reading (the fake
    // parser answers with the fixture's ground truth, whose engine is `fixture`).
    const [stored] = await listActive(app.db.receipts);
    expect(stored?.extraction.engine).toBe('fixture');

    // The reading that was replaced is still there, and so is Gemini's.
    expect(askButton()).toBeNull();
    click('Arată citirea anterioară');
    expect(total(1)).toBe('17,19');
    expect(screen.queryByText(/Bonul este citit cu Gemini/)).toBeNull();
    expect(askButton()).toBeTruthy();
    click('Arată citirea Gemini');
    expect(total(1)).toBe('17,89');
  });

  it('is saved with the receipt: its lines replace the old ones and the extraction names the model', async () => {
    await reviewPhoto();
    await readWithAi();
    await screen.findByText(/Bonul este citit cu Gemini/);

    click('Salvează ciorna');
    expect(await screen.findByText('Ciorna a fost salvată.')).toBeTruthy();

    const [receipt] = await listActive(app.db.receipts);
    expect(receipt?.extraction).toMatchObject({
      engine: 'gemini',
      parser: 'gemini-3.5-flash-lite',
    });
    const stored = await getReceiptWithLines(app.db, receipt?.id ?? '');
    expect(stored?.lines.map((line) => [line.rawName, line.lineTotalBani])).toEqual(
      truth.lines.map((line) => [line.rawName, line.lineTotalBani]),
    );
    // The first reading's lines are tombstones, not leftovers.
    expect(
      await app.db.lines
        .where('receiptId')
        .equals(receipt?.id ?? '')
        .count(),
    ).toBe(8);
    // After the save the other reading is no longer offered.
    expect(screen.queryByRole('button', { name: /Arată citirea/ })).toBeNull();
  });

  it('keeps the store the user chose when Gemini cannot tell it', async () => {
    await reviewPhoto();
    mock.answer = answerFromReceipt({ ...truth, chain: 'unknown' });
    expect(field('Magazin').value).toBe('mega-image');

    await readWithAi();
    await screen.findByText(/Bonul este citit cu Gemini/);
    expect(field('Magazin').value).toBe('mega-image');
  });

  it('puts what the model got wrong where the review shows it', async () => {
    await reviewPhoto();
    mock.answer = answerFromReceipt({
      ...truth,
      lines: truth.lines.map((line, index) =>
        index === 3 ? { ...line, lineTotalBani: 1099 } : line,
      ),
    });
    await readWithAi();
    await screen.findByText(/Bonul este citit cu Gemini/);
    expect(screen.getByText(/diferență/)).toBeTruthy();
    expect(screen.getByRole('region', { name: /Avertismente/ }).textContent).toContain(
      'diferă de totalul bonului',
    );
  });

  it('asks for the photo again when it is no longer in memory, and sends only when one is chosen', async () => {
    const { router } = await reviewPhoto();
    const [draft] = await listActive(app.db.receipts);
    // The app was reloaded: the draft is in the database, the photo is gone.
    clearReviewSessions();
    await goTo(router, '/bonuri');
    await goTo(router, `/bonuri/${draft?.id ?? ''}`);
    await screen.findByRole('heading', { level: 2, name: 'Detalii bon' });

    click('Citește cu AI');
    const dialog = await screen.findByRole('dialog', { name: 'Trimiți poza la Gemini?' });
    expect(dialog.textContent).toContain('Poza originală nu mai este în memorie');
    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Trimite poza la Gemini' })
        .disabled,
    ).toBe(true);

    fireEvent.change(within(dialog).getByLabelText('Poza bonului'), {
      target: { files: [new File(['jpeg'], 'bon.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => {
      expect(
        within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Trimite poza la Gemini' })
          .disabled,
      ).toBe(false);
    });
    click('Trimite poza la Gemini');
    expect(await screen.findByText(/Bonul este citit cu Gemini/)).toBeTruthy();
    expect(mock.generates).toHaveLength(1);
  });
});

describe('when the reading fails', () => {
  it('says why in Romanian and leaves the receipt as it was, ready for another try', async () => {
    await reviewPhoto();
    const failure = async (expected: RegExp) => {
      await readWithAi();
      expect((await screen.findByRole('alert')).textContent).toMatch(expected);
      // Nothing changed: the first reading is on screen, there is nothing to swap, the action is still there.
      expect(total(1)).toBe('17,19');
      expect(screen.queryByRole('button', { name: /Arată citirea/ })).toBeNull();
      expect(askButton()).toBeTruthy();
    };

    mock.revokeKey(FAKE_KEY);
    await failure(/Google nu acceptă cheia API/);
    mock.addKey(FAKE_KEY);

    mock.failNext(
      /generateContent/,
      googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded', [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
        },
      ]),
    );
    await failure(/cota zilnică/);

    mock.failNext(/generateContent/, googleError(503, 'UNAVAILABLE', 'The model is overloaded.'));
    await failure(/suprasolicitat/);

    mock.answer = candidateReply('{"lines":[]}', 'SAFETY');
    await failure(/refuzat să citească poza/);

    mock.answer = 'not json at all';
    await failure(/nu a putut fi înțeles/);

    mock.answer = JSON.stringify({ lines: [{ name: 'X', total: 1e12 }] });
    await failure(/nu a putut fi înțeles/);

    wireMockGemini(app.db, mock, false);
    await failure(/Nu ești conectat la internet/);
    // Offline, nothing was even attempted: six readings reached Google, three of them an answer.
    expect(mock.requests.filter((request) => request.method === 'POST')).toHaveLength(6);
    expect(mock.generates).toHaveLength(3);
  });

  it('can be cancelled while the answer is awaited', async () => {
    await reviewPhoto();
    mock.hold(/generateContent/);
    await readWithAi();
    expect(await screen.findByText(/Gemini citește bonul/)).toBeTruthy();

    click('Anulează citirea');
    expect(await screen.findByText('Citirea a fost oprită.')).toBeTruthy();
    expect(total(1)).toBe('17,19');
    expect(askButton()).toBeTruthy();
  });
});
