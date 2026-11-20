// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ParsedReceipt } from '@/domain';
import { clearReviewSessions } from '@/import';
import { pngFile } from '@/import/testing';
import { getReceiptWithLines, listActive } from '@/storage';
import { appHarness, change, click, expectFocus, field, goTo, importPdf } from './testing';

const app = appHarness();

describe('import -> review -> edit a price -> confirm (Kaufland)', () => {
  it('re-validates after every edit and stores the derived unit prices', async () => {
    const { expected } = app.install('kaufland-2026-11-07');
    const router = app.renderApp('/adauga');
    await importPdf(router, 'kaufland.pdf');

    // The draft is saved before the review opens, so it survives a reload.
    expect(router.state.location.pathname).toMatch(/^\/bonuri\/[0-9A-Z]{26}$/);
    expect((await listActive(app.db.receipts)).map((receipt) => receipt.status)).toEqual(['draft']);

    expect(field('Magazin').value).toBe('kaufland');
    expect(field('Data').value).toBe('2026-11-07');
    expect(field('Total bon (lei)').value).toBe('208,79');
    expect(screen.getByText(/se potrivesc/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Produse (18)' })).toBeTruthy();
    expect(screen.getByText('Preț plătit: 24,99 lei / kg')).toBeTruthy();

    // A price is corrected: the live sum disagrees with the printed total and says so.
    change('Total linie (lei), linia 9', '10,09');
    expect(await screen.findByText(/diferență \+0,10 lei/)).toBeTruthy();
    const warnings = screen.getByRole('region', { name: /Avertismente/ });
    expect(within(warnings).getByText('Suma nu se potrivește')).toBeTruthy();
    expect(within(warnings).getByText(/Suma liniilor \(208,89 lei\) diferă/)).toBeTruthy();

    // ...until the printed total is corrected too.
    change('Total bon (lei)', '208,89');
    await waitFor(() => {
      expect(screen.queryByText(/Suma liniilor \(/)).toBeNull();
    });
    expect(screen.getByText(/se potrivesc/)).toBeTruthy();

    click('Confirmă bonul');
    expect(await screen.findByText('Bonul a fost confirmat.')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/bonuri');

    const link = screen.getByRole('link', { name: /Kaufland/ });
    expect(within(link).getByText('Confirmat')).toBeTruthy();
    expect(within(link).getByText('208,89 lei')).toBeTruthy();

    const [receipt] = await listActive(app.db.receipts);
    expect(receipt).toMatchObject({
      status: 'confirmed',
      totalBani: 20889,
      paidBani: 18879,
      purchasedAt: '2026-11-07T18:31:47',
      source: { kind: 'pdf', fileName: 'kaufland.pdf' },
    });
    const stored = await getReceiptWithLines(app.db, receipt?.id ?? '');
    const byName = (name: string) => stored?.lines.find((line) => line.rawName === name);
    expect(stored?.lines.map((line) => line.rawName)).toEqual(
      expected.lines.map((line) => line.rawName),
    );
    // The edited line, and the prices the plan promises, derived from what was confirmed.
    expect(byName('UMERASE LEMN')).toMatchObject({ lineTotalBani: 1009, paidUnitBani: 1009 });
    expect(byName('PULPE DEZOSATE TV')).toMatchObject({ paidUnitBani: 2499, baseUnit: 'kg' });
    expect(byName('KLC HARTIE IG 8ROLE')).toMatchObject({
      baseUnit: 'role',
      pricePerBaseMilliBani: 144_875,
    });
  });

  it('keeps an accepted difference when the user insists on it', async () => {
    app.install('kaufland-2026-11-07');
    const router = app.renderApp('/adauga');
    await importPdf(router);

    change('Total linie (lei), linia 9', '10,09');
    click('Confirmă bonul');
    const summary = await screen.findByRole('alert');
    expect(
      within(summary).getByText('Confirmă diferența dintre suma liniilor și total.'),
    ).toBeTruthy();
    const accept = screen.getByLabelText<HTMLInputElement>(
      'Confirm că diferența de 0,10 lei față de total este corectă',
    );
    await expectFocus(accept);

    fireEvent.click(accept);
    click('Confirmă bonul');
    expect(await screen.findByText('Bonul a fost confirmat.')).toBeTruthy();
    expect((await listActive(app.db.receipts))[0]).toMatchObject({
      status: 'confirmed',
      totalBani: 20879,
    });
  });
});

describe('a date in the future (Lidl)', () => {
  it('must be accepted explicitly before the receipt is confirmed', async () => {
    app.install('lidl-2026-12-29', { kind: 'pasted-text' });
    const router = app.renderApp('/adauga');
    await goTo(router, '/adauga');
    change('Textul bonului', 'LIDL 29/12/2026');
    click('Citește textul');
    await screen.findByRole('heading', { level: 2, name: 'Detalii bon' });

    expect(field('Magazin').value).toBe('lidl');
    const warnings = screen.getByRole('region', { name: /Avertismente/ });
    expect(within(warnings).getByText('Dată în viitor')).toBeTruthy();
    expect(
      within(warnings).getByText('Data bonului (29.12.2026 17:12) este în viitor.'),
    ).toBeTruthy();

    // Confirming without accepting it is refused, and focus goes to the checkbox that fixes it.
    click('Confirmă bonul');
    const summary = await screen.findByRole('alert');
    expect(within(summary).getByText('Confirmă că data din viitor este corectă.')).toBeTruthy();
    const accept = screen.getByLabelText('Confirm că data bonului (29.12.2026 17:12) este corectă');
    await expectFocus(accept);
    expect((await listActive(app.db.receipts))[0]?.status).toBe('draft');

    fireEvent.click(accept);
    click('Confirmă bonul');
    expect(await screen.findByText('Bonul a fost confirmat.')).toBeTruthy();
    expect(await listActive(app.db.receipts)).toMatchObject([
      { status: 'confirmed', purchasedAt: '2026-12-29T17:12:30' },
    ]);
  });

  it('lapses when the date is edited to another future day', async () => {
    app.install('lidl-2026-12-29', { kind: 'pasted-text' });
    const router = app.renderApp('/adauga');
    await goTo(router, '/adauga');
    change('Textul bonului', 'LIDL');
    click('Citește textul');
    await screen.findByRole('heading', { level: 2, name: 'Detalii bon' });

    fireEvent.click(screen.getByLabelText(/Confirm că data bonului \(29\.12\.2026 17:12\)/));
    change('Data', '2027-01-05');
    const again = screen.getByLabelText(/Confirm că data bonului \(05\.01\.2027 17:12\)/);
    expect((again as HTMLInputElement).checked).toBe(false);

    // A date that is not in the future needs no acceptance at all.
    change('Data', '2026-11-19');
    await waitFor(() => {
      expect(screen.queryByText('Dată în viitor')).toBeNull();
    });
  });
});

describe('a receipt that is already stored', () => {
  it('warns about the duplicate, links to the twin and can be deleted', async () => {
    app.install('kaufland-2026-11-07');
    const router = app.renderApp('/adauga');
    await importPdf(router, 'a.pdf', 'same bytes');
    await importPdf(router, 'b.pdf', 'same bytes');

    const warnings = screen.getByRole('region', { name: /Avertismente/ });
    expect(within(warnings).getByText('Posibil duplicat')).toBeTruthy();
    expect(
      within(warnings).getByRole('link', { name: /Deschide bonul similar din 07\.11\.2026/ }),
    ).toBeTruthy();

    click('Confirmă bonul');
    expect(
      within(await screen.findByRole('alert')).getByText('Confirmă că acesta nu este un duplicat.'),
    ).toBeTruthy();

    // The user decides it is the same receipt and deletes the copy.
    click('Șterge bonul');
    const dialog = await screen.findByRole('dialog', { name: 'Ștergi bonul?' });
    await expectFocus(within(dialog).getByRole('button', { name: 'Renunță' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Șterge definitiv' }));

    expect(await screen.findByText('Bonul a fost șters.')).toBeTruthy();
    expect(await listActive(app.db.receipts)).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: /Kaufland/ })).toHaveLength(1);
  });

  it('closes the delete dialog with Escape and gives focus back', async () => {
    app.install('kaufland-2026-11-07');
    const router = app.renderApp('/adauga');
    await importPdf(router);

    const trigger = screen.getByRole('button', { name: 'Șterge bonul' });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole('dialog', { name: 'Ștergi bonul?' });
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await expectFocus(trigger);
    expect(await listActive(app.db.receipts)).toHaveLength(1);
  });
});

describe('the store of a receipt that names none (Mega Image)', () => {
  it('can be chosen by the user, and is created for that chain', async () => {
    app.install('mega-image-2026-11-03', {
      kind: 'pasted-text',
      receipt: (expected) => ({ ...expected, chain: 'unknown' }),
    });
    const router = app.renderApp('/adauga');
    await goTo(router, '/adauga');
    change('Textul bonului', 'ALWAYS ULTRA 16BUC 17,89');
    click('Citește textul');
    await screen.findByRole('heading', { level: 2, name: 'Detalii bon' });

    expect(field('Magazin').value).toBe('unknown');
    const warnings = screen.getByRole('region', { name: /Avertismente/ });
    expect(within(warnings).getByText('Magazin necunoscut')).toBeTruthy();

    change('Magazin', 'mega-image');
    await waitFor(() => {
      expect(screen.queryByText('Magazin necunoscut')).toBeNull();
    });
    expect(screen.queryByLabelText('Denumirea magazinului')).toBeNull();

    click('Confirmă bonul');
    expect(await screen.findByText('Bonul a fost confirmat.')).toBeTruthy();
    const [receipt] = await listActive(app.db.receipts);
    expect(await app.db.stores.get(receipt?.storeId ?? '')).toMatchObject({
      chain: 'mega-image',
      name: 'Mega Image',
    });
    expect(screen.getByRole('link', { name: /Mega Image/ })).toBeTruthy();
  });
});

describe('line crops', () => {
  it('shows the part of the photo a line was read from', async () => {
    const urls = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:crop');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    const withRegion = (expected: ParsedReceipt): ParsedReceipt => ({
      ...expected,
      lines: expected.lines.map((line) =>
        line.idx === 0 ? { ...line, bbox: { x: 10, y: 20, w: 300, h: 24 } } : line,
      ),
    });
    const { engines } = app.install('kaufland-2026-11-07', { receipt: withRegion });
    const router = app.renderApp('/adauga');
    await goTo(router, '/adauga');
    const photo = pngFile('bon.png');
    fireEvent.change(screen.getByLabelText('Fotografiază bonul'), { target: { files: [photo] } });

    const crop = await screen.findByRole('img', { name: 'Decupaj din bon pentru linia 1' });
    expect(crop.getAttribute('src')).toBe('blob:crop');
    expect(engines.calls.cropRegion).toEqual([
      { image: photo, bbox: { x: 10, y: 20, w: 300, h: 24 }, options: { padding: 8 } },
    ]);
    expect(urls).toHaveBeenCalledTimes(1);
    // Only the line with a region has a crop.
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('leaves the review usable when the photo is gone (after a reload)', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:crop');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    app.install('kaufland-2026-11-07', {
      receipt: (expected) => ({
        ...expected,
        lines: expected.lines.map((line) => ({ ...line, bbox: { x: 1, y: 1, w: 9, h: 9 } })),
      }),
    });
    const router = app.renderApp('/adauga');
    await goTo(router, '/adauga');
    fireEvent.change(screen.getByLabelText('Fotografiază bonul'), {
      target: { files: [pngFile('bon.png')] },
    });
    await screen.findByRole('img', { name: 'Decupaj din bon pentru linia 1' });
    const [receipt] = await listActive(app.db.receipts);

    // A new session knows nothing of the image: same receipt, no crops, no error.
    clearReviewSessions();
    await goTo(router, '/bonuri');
    await goTo(router, `/bonuri/${receipt?.id}`);
    await screen.findByRole('heading', { level: 2, name: 'Produse (18)' });
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});
