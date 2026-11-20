// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setImportServices } from '@/import';
import { confirmDraft, draftFromParsed, saveDraft, type ImportServices } from '@/import';
import { sampleReceipt, testIds, testServices } from '@/import/testing';
import { appHarness, goTo } from './testing';

const app = appHarness();

async function store(
  services: ImportServices,
  options: { chain?: 'kaufland' | 'lidl'; purchasedAt?: string; confirm?: boolean } = {},
) {
  const parsed = sampleReceipt({
    chain: options.chain ?? 'kaufland',
    ...(options.purchasedAt ? { purchasedAt: options.purchasedAt } : {}),
  });
  const draft = draftFromParsed(parsed, { kind: 'pdf' }, testIds);
  if (!options.purchasedAt) delete draft.purchasedAt;
  return options.confirm ? (await confirmDraft(services, draft)).saved : saveDraft(services, draft);
}

async function seed() {
  const services = testServices(app.db);
  await store(services, { purchasedAt: '2026-11-07T18:31:47', confirm: true });
  await store(services, { chain: 'lidl', purchasedAt: '2026-11-12T09:05' });
  await store(services, { purchasedAt: '2026-10-30', confirm: true });
  await store(services, { chain: 'lidl' });
  setImportServices(services);
}

const rows = () => within(screen.getByRole('list', { name: 'Bonuri' })).getAllByRole('listitem');

describe('receipts list', () => {
  it('lists receipts newest first with store, date, total and state', async () => {
    await seed();
    const router = app.renderApp('/bonuri');
    await screen.findByRole('list', { name: 'Bonuri' });

    expect(rows().map((row) => row.textContent)).toEqual([
      // A draft without a purchase date goes by the day it was created.
      'LidlCiornăFără dată · PDF39,45 lei',
      'LidlCiornă12.11.2026 09:05 · PDF39,45 lei',
      'KauflandConfirmat07.11.2026 18:31 · PDF39,45 lei',
      'KauflandConfirmat30.10.2026 · PDF39,45 lei',
    ]);
    expect(screen.getByText('Ai 2 ciorne de verificat.', { exact: false })).toBeTruthy();
    expect(screen.getByText('4 bonuri')).toBeTruthy();

    const first = within(rows()[1] as HTMLElement).getByRole('link');
    fireEvent.click(first);
    await screen.findByRole('heading', { level: 2, name: 'Detalii bon' });
    expect(router.state.location.pathname).toMatch(/^\/bonuri\/[0-9A-Z]{26}$/);
  });

  it('filters by state, store and month', async () => {
    await seed();
    app.renderApp('/bonuri');
    await screen.findByRole('list', { name: 'Bonuri' });

    const drafts = screen.getByRole('button', { name: 'Ciorne' });
    expect(drafts.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(drafts);
    expect(drafts.getAttribute('aria-pressed')).toBe('true');
    expect(rows()).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('Magazin'), {
      target: {
        value: screen.getByRole<HTMLOptionElement>('option', { name: 'Kaufland' }).value,
      },
    });
    expect(screen.getByText('Niciun bon nu se potrivește filtrelor alese.')).toBeTruthy();
    expect(screen.getByText('0 bonuri')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Toate' }));
    fireEvent.change(screen.getByLabelText('Luna'), { target: { value: '2026-10' } });
    expect(rows().map((row) => row.textContent)).toEqual([
      'KauflandConfirmat30.10.2026 · PDF39,45 lei',
    ]);
    expect(screen.getByText('1 bon')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'noiembrie 2026' })).toBeTruthy();
  });

  it('invites the user to add the first receipt', async () => {
    app.install('kaufland-2026-11-07');
    const router = app.renderApp('/bonuri');

    expect(await screen.findByText('Nu ai niciun bon salvat încă.')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Adaugă primul bon' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/adauga');
    });
  });

  it('says so when the database cannot be opened', async () => {
    setImportServices({ getDb: () => Promise.reject(new Error('IndexedDB is blocked')) });
    app.renderApp('/bonuri');

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Nu am putut deschide bonurile salvate.')).toBeTruthy();
    expect(within(alert).getByText('IndexedDB is blocked')).toBeTruthy();
  });

  it('reports a missing receipt instead of an empty form', async () => {
    app.install('kaufland-2026-11-07');
    const router = app.renderApp('/bonuri/01ARZ3NDEKTSV4RRFFQ69G5FAV');

    expect(await screen.findByText('Bonul căutat nu există sau a fost șters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Înapoi la bonuri' }));
    await goTo(router, '/bonuri');
    expect(await screen.findByText('Nu ai niciun bon salvat încă.')).toBeTruthy();
  });
});
