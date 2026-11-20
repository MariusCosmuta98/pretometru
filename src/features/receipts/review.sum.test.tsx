// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatLei } from '@/domain';
import { formatLeiInput } from '@/import';
import { SUM_TOLERANCE_BANI } from '@/parsers';
import { getReceiptWithLines, listActive } from '@/storage';
import { noticeClass } from '@/ui/controls';
import { appHarness, change, click, importPdf } from './testing';

const app = appHarness();

// The Kaufland fixture adds up to the ban: 208,79 in the lines and on the receipt. Line 9 is 9,99.
const TOTAL_BANI = 20879;
const LINE_9_BANI = 999;
const LIMIT = `±${formatLei(SUM_TOLERANCE_BANI)}`;

const signed = (bani: number) => `${bani > 0 ? '+' : '−'}${formatLei(Math.abs(bani))}`;

/** The line under the receipt's fields: Σ lines, the printed total and what they say about each other. */
const sumLine = () => screen.getByText(/Suma liniilor:/);
const warningsPanel = () => screen.getByRole('region', { name: /Avertismente/ });

const sumText = (sumBani: number, totalBani: number, tail: string) =>
  `Suma liniilor: ${formatLei(sumBani)} · Total bon: ${formatLei(totalBani)} · ${tail}`;

/** Makes the lines add up to `bani` more than the printed total (less when negative). */
function differBy(bani: number) {
  if (bani > 0) change('Total linie (lei), linia 9', formatLeiInput(LINE_9_BANI + bani));
  else change('Total bon (lei)', formatLeiInput(TOTAL_BANI - bani));
}

/** What the screen shows for lines that add up to `TOTAL_BANI + max(d, 0)` against a total of `... + max(-d, 0)`. */
const amounts = (bani: number) => ({
  sum: TOTAL_BANI + Math.max(bani, 0),
  total: TOTAL_BANI + Math.max(-bani, 0),
});

async function openKaufland() {
  app.install('kaufland-2026-11-07');
  await importPdf(app.renderApp('/adauga'));
}

describe('the sum of the lines against the printed total', () => {
  it('says that they match when they do, in both places', async () => {
    await openKaufland();

    expect(sumLine().textContent).toBe(sumText(TOTAL_BANI, TOTAL_BANI, 'se potrivesc'));
    expect(sumLine().className).toBe(noticeClass.success);
    const panel = warningsPanel();
    expect(within(panel).getByRole('heading', { level: 2, name: 'Avertismente' })).toBeTruthy();
    expect(
      within(panel).getByText(
        'Nu am găsit nicio problemă: suma liniilor se potrivește cu totalul.',
      ),
    ).toBeTruthy();
  });

  describe('inside the tolerance of the parsers', () => {
    // A ban off, in both directions, and right at the limit.
    it.each([
      ['a ban more in the lines', 1],
      ['a ban less in the lines', -1],
      ['the limit, more in the lines', SUM_TOLERANCE_BANI],
      ['the limit, less in the lines', -SUM_TOLERANCE_BANI],
    ])(
      'shows %s as a signed, accepted difference and does not claim that they match',
      async (_, bani) => {
        await openKaufland();

        differBy(bani);

        await screen.findByText(/diferență/);
        const { sum, total } = amounts(bani);
        expect(sumLine().textContent).toBe(
          sumText(sum, total, `diferență ${signed(bani)}, acceptată (în limita de ${LIMIT})`),
        );
        // Not green (a perfect match) and not amber (a problem).
        expect(sumLine().className).toBe(noticeClass.info);

        const panel = warningsPanel();
        expect(within(panel).getByRole('heading', { level: 2, name: 'Avertismente' })).toBeTruthy();
        expect(
          within(panel).getByText(
            `Nu am găsit nicio problemă: suma liniilor diferă de total cu ${signed(bani)}, în limita acceptată de ${LIMIT}.`,
          ),
        ).toBeTruthy();
        expect(panel.textContent).not.toContain('se potrivește cu totalul');
        // Nothing to accept: the parsers raise no warning here.
        expect(within(panel).queryByRole('checkbox')).toBeNull();
        expect(screen.queryByText('Suma nu se potrivește')).toBeNull();
      },
    );

    it('lets the receipt be confirmed as it is, amounts untouched', async () => {
      app.install('metro-invoice-2026-08-12');
      await importPdf(app.renderApp('/adauga'));

      // The printed invoice adds up to 363,42 against a printed total of 363,41.
      expect(sumLine().textContent).toBe(
        sumText(36342, 36341, `diferență +0,01 lei, acceptată (în limita de ${LIMIT})`),
      );
      expect(sumLine().className).toBe(noticeClass.info);
      expect(
        within(warningsPanel()).getByText(
          `Nu am găsit nicio problemă: suma liniilor diferă de total cu +0,01 lei, în limita acceptată de ${LIMIT}.`,
        ),
      ).toBeTruthy();

      click('Confirmă bonul');
      expect(await screen.findByText('Bonul a fost confirmat.')).toBeTruthy();

      const [receipt] = await listActive(app.db.receipts);
      const stored = await getReceiptWithLines(app.db, receipt?.id ?? '');
      expect(receipt).toMatchObject({ status: 'confirmed', totalBani: 36341 });
      expect(stored?.lines.reduce((sum, line) => sum + line.lineTotalBani, 0)).toBe(36342);
    });

    it('leaves the other warnings alone, and says nothing about the sum in their place', async () => {
      await openKaufland();

      change('Data', '2026-12-30');
      differBy(-1);

      expect(await screen.findByText(/diferență/)).toBe(sumLine());
      const panel = warningsPanel();
      expect(
        within(panel).getByRole('heading', { level: 2, name: 'Avertismente (1)' }),
      ).toBeTruthy();
      expect(within(panel).getByText('Dată în viitor')).toBeTruthy();
      expect(panel.textContent).not.toContain('Nu am găsit nicio problemă');
      expect(panel.textContent).not.toContain('diferă de total');
      expect(sumLine().textContent).toBe(
        sumText(
          TOTAL_BANI,
          TOTAL_BANI + 1,
          `diferență −0,01 lei, acceptată (în limita de ${LIMIT})`,
        ),
      );
    });
  });

  describe('beyond the tolerance of the parsers', () => {
    it('is a problem to confirm, right after the limit, with the sum below the total', async () => {
      await openKaufland();
      const bani = -(SUM_TOLERANCE_BANI + 1);

      differBy(bani);

      await screen.findByText(/diferență/);
      const { sum, total } = amounts(bani);
      expect(sumLine().textContent).toBe(
        sumText(sum, total, `diferență ${signed(bani)}, peste limita de ${LIMIT}`),
      );
      expect(sumLine().className).toBe(noticeClass.warning);

      const panel = warningsPanel();
      expect(
        within(panel).getByRole('heading', { level: 2, name: 'Avertismente (1)' }),
      ).toBeTruthy();
      expect(within(panel).getByText('Suma nu se potrivește')).toBeTruthy();
      expect(
        within(panel).getByText(
          `Suma liniilor (${formatLei(sum)}) diferă de totalul bonului (${formatLei(total)}) cu ${formatLei(SUM_TOLERANCE_BANI + 1)}.`,
        ),
      ).toBeTruthy();
      expect(
        within(panel).getByLabelText(
          `Confirm că diferența de ${formatLei(SUM_TOLERANCE_BANI + 1)} față de total este corectă`,
        ),
      ).toBeTruthy();
      expect(panel.textContent).not.toContain('Nu am găsit nicio problemă');

      // Still has to be accepted before the receipt can be confirmed.
      click('Confirmă bonul');
      expect(
        within(await screen.findByRole('alert')).getByText(
          'Confirmă diferența dintre suma liniilor și total.',
        ),
      ).toBeTruthy();
    });

    it('keeps the separate warnings next to it, right after the limit, with the sum above the total', async () => {
      await openKaufland();
      const bani = SUM_TOLERANCE_BANI + 1;

      differBy(bani);

      await screen.findByText(/diferență/);
      const { sum, total } = amounts(bani);
      expect(sumLine().textContent).toBe(
        sumText(sum, total, `diferență ${signed(bani)}, peste limita de ${LIMIT}`),
      );
      expect(sumLine().className).toBe(noticeClass.warning);

      // The edited line is also off against the VAT printed for its rate: its own warning.
      const panel = warningsPanel();
      expect(within(panel).getByText('Suma nu se potrivește')).toBeTruthy();
      expect(within(panel).getByText('TVA nu se potrivește')).toBeTruthy();
      expect(panel.textContent).not.toContain('Nu am găsit nicio problemă');
    });
  });
});
