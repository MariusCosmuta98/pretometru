import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openApp, visitFresh, watchForProblems } from './support/app.ts';

async function checkAccessibility(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })),
    `${screen}: axe WCAG 2.2 AA violations`,
  ).toEqual([]);
}

test('confirmed imports feed the cheapest-store comparison and a shopping list that survives offline', async ({
  page,
  context,
}) => {
  const problems = watchForProblems(page);
  const product = /Lapte UHT/i;
  const listName = 'Cumpărături de test';
  // Freeze Date, not timers, so both invented receipts stay inside the 90-day comparison window.
  await page.clock.setFixedTime(new Date('2026-11-20T12:00:00Z'));
  await openApp(page, 'adauga');
  await expect(page.getByLabel('Textul bonului')).toBeVisible();
  await checkAccessibility(page, 'Import');

  for (const [store, total] of [
    ['Kaufland', '7,49'],
    ['Mega Image', '5,99'],
  ] as const) {
    await page
      .getByLabel('Textul bonului')
      .fill(
        [
          'MAGAZIN EXEMPLU SRL',
          `LAPTE UHT 1L ${total} B`,
          `TOTAL ${total}`,
          'DATA: 19/11/2026 ORA: 09:30:15',
        ].join('\n'),
      );
    await page.getByRole('button', { name: 'Citește textul' }).click();
    await expect(page.getByRole('heading', { name: 'Detalii bon' })).toBeVisible();
    await expect(page.getByLabel('Total bon (lei)')).toHaveValue(total);
    await expect(page.getByLabel('Total linie (lei), linia 1')).toHaveValue(total);
    await page.getByLabel('Magazin', { exact: true }).selectOption({ label: store });
    if (store === 'Kaufland') await checkAccessibility(page, 'Review');
    await page.getByRole('button', { name: 'Alege produsul, linia 1' }).click();
    const picker = page.getByRole('dialog', { name: 'Produs pentru linia 1' });
    if (store === 'Kaufland') {
      await expect(picker.getByLabel('Preț comparat pe')).toHaveValue('l');
      await picker.getByLabel('Nume produs').fill('Lapte UHT');
      await picker.getByLabel('Categorie').selectOption({ label: '🥛 Lactate & ouă' });
      await picker.getByRole('button', { name: 'Creează produsul' }).click();
    } else {
      await picker.getByRole('button', { name: /Lapte UHT/i }).click();
    }
    await expect(picker).toBeHidden();
    await page.getByRole('button', { name: 'Confirmă bonul' }).click();
    const saved = page
      .getByRole('list', { name: 'Bonuri' })
      .getByRole('link', { name: new RegExp(store) });
    await expect(saved).toContainText('Confirmat');
    await expect(saved).toContainText(`${total} lei`);
    if (store === 'Kaufland')
      await page.getByRole('link', { name: 'Adaugă bon', exact: true }).click();
  }

  await page.getByRole('link', { name: 'Produse', exact: true }).click();
  await page.getByRole('link', { name: product }).click();
  const comparison = page
    .getByRole('region', { name: 'Comparație pe magazine' })
    .getByRole('table');
  const assertComparison = async () => {
    const rows = comparison.getByRole('row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1).getByRole('rowheader')).toContainText('Mega Image');
    await expect(rows.nth(1)).toContainText('5,99 lei/l');
    await expect(rows.nth(2).getByRole('rowheader')).toHaveText('Kaufland');
    await expect(rows.nth(2)).toContainText('7,49 lei/l');
  };
  await assertComparison();
  const comparisonRoute = new URL(page.url()).hash.slice(2);
  await checkAccessibility(page, 'Comparison');

  await page.getByRole('link', { name: 'Liste', exact: true }).click();
  await page.getByLabel('Listă nouă').fill(listName);
  await page.getByRole('button', { name: 'Creează' }).click();
  await expect(page.getByRole('heading', { name: listName })).toBeVisible();
  const listRoute = new URL(page.url()).hash.slice(2);
  await page.getByLabel('Adaugă un articol').fill('Lapte UHT');
  await page.getByRole('button', { name: /Adaugă Lapte UHT/i }).click();
  const cheapest = page.getByRole('region', { name: 'Mega Image' });
  const item = cheapest.getByRole('checkbox', { name: product });
  await expect(cheapest).toContainText('Cel mai ieftin la Mega Image: 5,99 lei/l');
  await expect(cheapest).toContainText('≈ 5,99 lei');
  await expect(item).not.toBeChecked();
  await checkAccessibility(page, 'Shopping list');

  await context.setOffline(true);
  await visitFresh(page, comparisonRoute);
  await assertComparison();
  await visitFresh(page, listRoute);
  await expect(cheapest).toContainText('≈ 5,99 lei');
  // The controlled checkbox updates after the asynchronous IndexedDB write.
  await item.click();
  await expect(item).toBeChecked();
  await visitFresh(page, listRoute);
  await expect(item).toBeChecked();
  expect(problems()).toEqual([]);
});
