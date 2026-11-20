import { expect, test, type Locator } from '@playwright/test';
import { openApp, visitFresh, watchForProblems } from './support/app.ts';
import { seedDashboard } from './support/dashboard-seed.ts';

// The clock of the fixtures, 20.11.2026: "this month" is November and the Lidl receipt (29.12) is in the future.
const NOW = '2026-11-20T12:00:00Z';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

/** How much of its track a bar fills (0 to 1); the bar is a decoration, so this is the only way to see it. */
async function filled(row: Locator): Promise<number> {
  const track = row.locator('div[aria-hidden="true"]').first();
  const bar = track.locator('div').first();
  const [trackBox, barBox] = await Promise.all([track.boundingBox(), bar.boundingBox()]);
  return trackBox && barBox ? barBox.width / trackBox.width : 0;
}

test.describe('Home and Statistics in the production build', () => {
  test('the first run invites to add a receipt, on both screens', async ({ page }) => {
    await openApp(page);

    await expect(
      page.getByRole('heading', { level: 2, name: 'Bine ai venit la Pretometru' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Adaugă primul bon' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Adaugă bon' })).toBeVisible();

    await visitFresh(page, 'statistici');
    await expect(page.getByText('Nu ai încă bonuri confirmate.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Adaugă un bon' })).toBeVisible();
  });

  test('Home shows the month, the categories, the last receipts and the price increases', async ({
    page,
  }) => {
    await openApp(page);
    const { milkId } = await seedDashboard(page);
    const problems = watchForProblems(page);
    await visitFresh(page, '');

    const month = page.getByRole('region', { name: /Luna aceasta/ });
    await expect(month).toContainText('noiembrie 2026');
    await expect(month).toContainText('254,65 lei'); // 188,79 paid at Kaufland + 65,86 at Mega Image
    await expect(month).toContainText('2 bonuri confirmate');
    await expect(month).toContainText('+49,65 lei (+24,2%)');
    await expect(month).toContainText('față de octombrie 2026 (205,00 lei)');

    const categories = page.getByRole('region', { name: 'Pe categorii' });
    const rows = categories.getByRole('list', {
      name: 'Cheltuieli pe categorii în noiembrie 2026',
    });
    await expect(rows.getByRole('listitem')).toHaveCount(5);
    await expect(rows.getByRole('listitem').first()).toContainText('Fără categorie');
    await expect(rows.getByRole('listitem').first()).toContainText('210,20 lei');
    await expect(rows.getByRole('listitem').last()).toContainText('Non-produs');
    await expect(rows.getByRole('listitem').last()).toContainText('0,70 lei');
    const totals = categories.getByRole('list', { name: 'Ajustări și total' });
    await expect(totals).toContainText('Tichete folosite la plată−20,00 lei');
    await expect(totals).toContainText('Total plătit254,65 lei');
    // The bars are drawn, so the style the page sets from script is allowed by the CSP of the build.
    expect(await filled(rows.getByRole('listitem').first())).toBeGreaterThan(0.95);
    expect(await filled(rows.getByRole('listitem').nth(1))).toBeGreaterThan(0.1);

    const recent = page.getByRole('region', { name: 'Ultimele bonuri' });
    const receipts = recent.getByRole('list', { name: 'Ultimele bonuri' }).getByRole('link');
    await expect(receipts).toHaveCount(5);
    await expect(receipts.first()).toContainText('29.12.2026');
    await expect(receipts.nth(1)).toContainText('Ciornă');
    await expect(receipts.nth(2)).toContainText('plătit 188,79 lei');
    await expect(page.getByText('Ai o ciornă de verificat.')).toBeVisible();

    const increases = page.getByRole('region', { name: 'Creșteri de preț' });
    await expect(increases).toContainText('ultimele 90 de zile');
    await expect(increases).toContainText('+19,8%');
    await expect(increases).toContainText('Kaufland Cluj · 5,00 → 5,99 lei/l');

    // A receipt opens its review, a price increase its product page.
    await receipts.nth(2).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Detalii bon' })).toBeVisible();
    await page.goBack();
    await increases.getByRole('link', { name: /Lapte UHT/ }).click();
    await expect(page).toHaveURL(new RegExp(`#/produse/${milkId}$`));

    expect(problems(), 'errors or failed requests').toEqual([]);
  });

  test('Statistics covers a chosen period, with the data of the device and no network', async ({
    page,
    context,
  }) => {
    await openApp(page);
    await seedDashboard(page);
    await context.setOffline(true);
    const problems = watchForProblems(page);
    await visitFresh(page, 'statistici');

    const summary = page.getByRole('region', { name: /Perioada/ });
    await expect(summary).toContainText('iunie 2026 – noiembrie 2026');
    await expect(summary).toContainText('823,06 lei'); // METRO, Kaufland twice, Mega Image
    await expect(summary).toContainText('4 bonuri confirmate');
    await expect(page.getByText(/Un bon are data în viitor \(decembrie 2026\)/)).toBeVisible();

    const months = page.getByRole('list', { name: 'Cheltuieli pe luni' }).getByRole('listitem');
    await expect(months).toHaveCount(6);
    await expect(months.first()).toContainText('noiembrie 2026');
    await expect(months.first()).toContainText('254,65 lei');

    const stores = page.getByRole('list', { name: 'Cheltuieli pe magazine' }).getByRole('listitem');
    await expect(stores.first()).toContainText('Kaufland Cluj');
    await expect(stores.first()).toContainText('393,79 lei');
    await expect(stores.first()).toContainText('2 bonuri');
    await expect(stores).toHaveCount(3);

    const adjustments = page.getByRole('list', { name: 'Ajustări și total' });
    await expect(adjustments).toContainText('Tichete folosite la plată−20,00 lei');
    await expect(adjustments).toContainText('Rotunjiri și diferențe−0,01 lei'); // METRO: 363,42 against 363,41

    await page.getByRole('button', { name: '3 luni' }).click();
    await expect(page).toHaveURL(/#\/statistici\?perioada=3$/);
    await expect(summary).toContainText('septembrie 2026 – noiembrie 2026');
    await expect(summary).toContainText('459,65 lei');

    await page.getByRole('button', { name: 'Tot' }).click();
    await expect(summary).toContainText('august 2026 – decembrie 2026');
    await expect(summary).toContainText('884,73 lei'); // the Lidl receipt of December counts in its own month
    await expect(months.first()).toContainText('decembrie 2026');
    await expect(page.getByText(/Un bon are data în viitor/)).toHaveCount(0);

    const increases = page.getByRole('region', { name: 'Creșteri de preț' });
    await expect(increases).toContainText('Lapte UHT');
    await expect(increases).toContainText('01.10.2026 → 07.11.2026');
    await expect(increases).toContainText('(+0,99 lei/l)');

    expect(problems(), 'errors or failed requests while offline').toEqual([]);
  });
});
