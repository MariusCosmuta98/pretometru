// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLastExportAt, MAX_BACKUP_BYTES, prepareExport } from '@/admin';
import { addProduct, addReceipt, addStore, resetDb, SEED, seededTestDb } from '@/admin/testing';
import { newId } from '@/domain';
import { makeReceipt } from '@/domain/testing';
import { createBackup, serializeBackup } from '@/domain';
import { createRecord, exportBackup, type PretometruDB } from '@/storage';
import BackupSection from './BackupSection';

const blobs = new Map<string, Blob>();
const downloads: Array<{ name: string; blob: Blob | undefined }> = [];

beforeEach(() => {
  blobs.clear();
  downloads.length = 0;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      const url = `blob:test/${blobs.size + 1}`;
      blobs.set(url, blob);
      return url;
    },
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ name: this.download, blob: blobs.get(this.href) });
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderSection(): Promise<PretometruDB> {
  const db = await resetDb();
  return db;
}

async function open() {
  render(<BackupSection />);
  await screen.findByRole('button', { name: 'Exportă datele' });
  // What the device holds is read a moment later: wait for it, as a person would.
  await screen.findByText(/Nu ai exportat încă o copie|Ultima exportare:/);
}

const backupFile = (text: string, name = 'copie.pretometru-backup.json') =>
  new File([text], name, { type: 'application/json' });

function pick(file: File) {
  fireEvent.change(screen.getByLabelText('Fișier de copie de siguranță'), {
    target: { files: [file] },
  });
}

/** The text of a backup that another device made. */
async function otherDeviceBackup(): Promise<{ text: string; storeName: string }> {
  const other = await seededTestDb();
  const store = await addStore(other, { name: 'Kaufland Cluj', branchCode: '1234' });
  const milk = await addProduct(other, 'Lapte UHT', SEED.dairy.id);
  await addReceipt(other, store.id, {
    lines: [{ name: 'LAPTE UHT 1L', productId: milk.id, categoryId: SEED.dairy.id }],
  });
  return { text: (await prepareExport(other)).text, storeName: store.name };
}

const downloaded = async (index = 0) =>
  JSON.parse((await downloads[index]?.blob?.text()) ?? 'null') as {
    format: string;
    exportedAt: string;
    data: Record<string, Array<Record<string, unknown>>>;
  };

describe('export', () => {
  it('shows what the device holds, and that nothing was exported yet', async () => {
    const db = await renderSection();
    const store = await addStore(db, { name: 'Kaufland Cluj' });
    await addReceipt(db, store.id);
    await open();

    expect(await screen.findByText(/\(1 bon și 1 magazin\)/)).toBeTruthy();
    expect(screen.getByText('Nu ai exportat încă o copie de pe acest dispozitiv.')).toBeTruthy();
  });

  it('downloads a dated backup file, then shows when it was made', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    const db = await renderSection();
    const store = await addStore(db, { name: 'Kaufland Cluj' });
    await addReceipt(db, store.id);
    await open();

    fireEvent.click(screen.getByRole('button', { name: 'Exportă datele' }));

    expect(await screen.findByText(/Am pregătit fișierul/)).toBeTruthy();
    expect(downloads.map((d) => d.name)).toEqual(['pretometru-2026-11-20.pretometru-backup.json']);
    const file = await downloaded();
    expect(file).toMatchObject({
      format: 'pretometru-backup',
      exportedAt: '2026-11-20T10:00:00.000Z',
    });
    expect(file.data['stores']?.map((s) => s['name'])).toEqual(['Kaufland Cluj']);
    expect(await screen.findByText(/Ultima exportare: 20 noiembrie 2026/)).toBeTruthy();
    expect(await getLastExportAt(db)).toBe('2026-11-20T10:00:00.000Z');
  });

  it('says which records had to be left out', async () => {
    const db = await renderSection();
    await db.products.put({
      id: newId(),
      updatedAt: '2026-11-01T10:00:00.000Z',
      name: '',
      categoryId: SEED.dairy.id,
      baseUnit: 'buc',
    });
    await open();

    fireEvent.click(screen.getByRole('button', { name: 'Exportă datele' }));

    expect(await screen.findByText(/Unele înregistrări nu au putut fi incluse/)).toBeTruthy();
    expect(screen.getByText('Ce a fost lăsat deoparte (1)')).toBeTruthy();
    expect(downloads).toHaveLength(1);
  });

  it('says so when the file cannot be prepared, and does not pretend it was exported', async () => {
    const db = await renderSection();
    await open();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error('no memory');
      },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Exportă datele' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Nu am putut pregăti fișierul',
    );
    expect(await getLastExportAt(db)).toBeUndefined();
  });
});

describe('import', () => {
  it('previews a file first and merges it by default', async () => {
    const db = await renderSection();
    const own = await addStore(db, { chain: 'metro', name: 'METRO' });
    const { text } = await otherDeviceBackup();
    await open();

    pick(backupFile(text, 'telefon.pretometru-backup.json'));

    const heading = await screen.findByRole('heading', { name: 'Fișierul ales' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    const card = heading.closest('section') as HTMLElement;
    expect(within(card).getByText(/telefon\.pretometru-backup\.json/)).toBeTruthy();
    expect(within(card).getByText('Versiunea formatului').nextElementSibling?.textContent).toBe(
      '1',
    );
    const row = (name: string) => within(card).getByRole('row', { name: new RegExp(`^${name}`) });
    expect(row('Bonuri').textContent).toBe('Bonuri10');
    expect(row('Magazine').textContent).toBe('Magazine10');
    expect(within(card).getByRole<HTMLInputElement>('radio', { name: /Îmbină/ }).checked).toBe(
      true,
    );
    // Nothing was written yet.
    expect(await db.receipts.count()).toBe(0);

    fireEvent.click(within(card).getByRole('button', { name: 'Importă datele' }));

    const result = await screen.findByRole('heading', { name: 'Import terminat' });
    await waitFor(() => expect(document.activeElement).toBe(result));
    expect(screen.getByText(/Date importate: \d+ (de )?înregistrări noi/)).toBeTruthy();
    expect(await db.receipts.count()).toBe(1);
    expect((await db.stores.toArray()).map((s) => s.name).sort()).toEqual([
      'Kaufland Cluj',
      'METRO',
    ]);
    expect((await db.stores.get(own.id))?.name).toBe('METRO');

    // "Gata" closes the result and puts focus back on the file field.
    fireEvent.click(screen.getByRole('button', { name: 'Gata' }));
    expect(screen.queryByRole('heading', { name: 'Import terminat' })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Fișier de copie de siguranță')),
    );
  });

  it('asks for a clear confirmation before replacing, and replaces only after it', async () => {
    const db = await renderSection();
    const own = await addStore(db, { chain: 'metro', name: 'Doar aici' });
    await addReceipt(db, own.id);
    const { text } = await otherDeviceBackup();
    await open();
    pick(backupFile(text));
    fireEvent.click(await screen.findByRole('radio', { name: /Înlocuiește tot/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Importă datele' }));

    const question = await screen.findByRole('group', {
      name: 'Înlocuiești datele de pe acest dispozitiv?',
    });
    expect(question.textContent).toContain('Acum ai 1 bon și 1 magazin.');
    expect(question.textContent).toContain('înlocuite cu 1 bon, 1 produs și 1 magazin din fișier');
    expect(question.textContent).toContain('Nu se poate anula.');
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(question).getByRole('button', { name: 'Anulează' }),
      ),
    );
    expect(await db.stores.get(own.id)).toBeDefined();

    // Backing out changes nothing.
    fireEvent.click(within(question).getByRole('button', { name: 'Anulează' }));
    expect(screen.queryByRole('group', { name: /Înlocuiești/ })).toBeNull();
    expect(await db.stores.get(own.id)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Importă datele' }));
    fireEvent.click(
      within(await screen.findByRole('group', { name: /Înlocuiești/ })).getByRole('button', {
        name: 'Înlocuiește datele',
      }),
    );

    expect(await screen.findByRole('heading', { name: 'Import terminat' })).toBeTruthy();
    expect(screen.getByText(/au fost înlocuite cu cele din fișier/)).toBeTruthy();
    expect(await db.stores.get(own.id)).toBeUndefined();
    expect((await db.stores.toArray()).map((s) => s.name)).toEqual(['Kaufland Cluj']);
    expect(await db.receipts.count()).toBe(1);
  });

  it('offers a copy of what is on the device before it is replaced', async () => {
    const db = await renderSection();
    const own = await addStore(db, { chain: 'metro', name: 'Doar aici' });
    const { text } = await otherDeviceBackup();
    await open();
    pick(backupFile(text));
    fireEvent.click(await screen.findByRole('radio', { name: /Înlocuiește tot/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Importă datele' }));
    const question = await screen.findByRole('group', { name: /Înlocuiești/ });

    fireEvent.click(
      within(question).getByRole('button', {
        name: 'Descarcă mai întâi o copie a datelor de acum',
      }),
    );

    expect(await within(question).findByText(/Am pregătit fișierul/)).toBeTruthy();
    expect(downloads).toHaveLength(1);
    expect((await downloaded()).data['stores']?.map((s) => s['id'])).toContain(own.id);
    expect(await db.stores.get(own.id)).toBeDefined();
  });

  it('refuses what is not a backup, in Romanian, and imports nothing', async () => {
    const db = await renderSection();
    await open();

    pick(backupFile('nu e json'));
    const notJson = await screen.findByRole('alert');
    expect(notJson.textContent).toContain('Fișierul nu este o copie de siguranță Pretometru');
    expect(notJson.textContent).toContain('.pretometru-backup.json');

    pick(backupFile('{"format":"altceva","formatVersion":1}'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Fișierul nu este o copie de siguranță Pretometru.',
      ),
    );
    expect(screen.queryByRole('heading', { name: 'Fișierul ales' })).toBeNull();
    expect(await db.stores.count()).toBe(0);
  });

  it('refuses a backup written by a newer version of the app', async () => {
    const db = await renderSection();
    await open();
    const newer = JSON.stringify({
      format: 'pretometru-backup',
      formatVersion: 2,
      exportedAt: '2027-01-01T10:00:00.000Z',
      data: {},
    });

    pick(backupFile(newer));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('o versiune mai nouă a aplicației (format 2)');
    expect(alert.textContent).toContain('înțelege formatul 1');
    expect(alert.textContent).toContain('Actualizează aplicația');
    expect(alert.textContent).toContain('Nu s-a importat nimic');
    expect(screen.queryByRole('button', { name: 'Importă datele' })).toBeNull();
    expect(await db.categories.count()).toBe(16);
  });

  it('refuses a damaged backup and keeps the technical reasons one click away', async () => {
    await renderSection();
    await open();
    const { text } = await otherDeviceBackup();
    const file = JSON.parse(text) as { data: { stores: Array<Record<string, unknown>> } };
    delete file.data.stores[0]?.['name'];

    pick(backupFile(JSON.stringify(file)));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('pare stricat sau modificat');
    expect(within(alert).getByText('Detalii tehnice')).toBeTruthy();
    expect(alert.textContent).toContain('data.stores.0.name');
  });

  it('refuses a file that is too big to be a backup, without reading it', async () => {
    await renderSection();
    await open();
    const huge = backupFile('{}');
    Object.defineProperty(huge, 'size', { value: MAX_BACKUP_BYTES + 1 });
    const read = vi.spyOn(huge, 'text');

    pick(huge);

    expect((await screen.findByRole('alert')).textContent).toContain('prea mare');
    expect(read).not.toHaveBeenCalled();
  });

  it('lets the user choose a good file after a refusal', async () => {
    await renderSection();
    await open();
    pick(backupFile('nu e json'));
    await screen.findByRole('alert');

    pick(backupFile((await otherDeviceBackup()).text));

    expect(await screen.findByRole('heading', { name: 'Fișierul ales' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says what a valid file points at that it does not contain', async () => {
    await renderSection();
    await open();
    const orphan = makeReceipt();
    const text = serializeBackup(
      createBackup(
        {
          stores: [],
          receipts: [orphan],
          lines: [],
          products: [],
          aliases: [],
          categories: [],
          lists: [],
          listItems: [],
          settings: [],
        },
        new Date(),
      ),
    );

    pick(backupFile(text));

    expect(
      await screen.findByText('1 bon face trimitere la un magazin care nu este în fișier.'),
    ).toBeTruthy();
  });

  it('keeps the file and the data when the database refuses, and says so', async () => {
    const db = await renderSection();
    const own = await addStore(db, { name: 'Al meu' });
    await open();
    pick(backupFile((await otherDeviceBackup()).text));
    const button = await screen.findByRole('button', { name: 'Importă datele' });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('boom'));

    fireEvent.click(button);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Importul nu a reușit, iar datele de pe acest dispozitiv nu au fost modificate',
    );
    expect(await db.stores.get(own.id)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Importă datele' })).toBeTruthy();
  });

  it('says when the device has no room left', async () => {
    const db = await renderSection();
    await open();
    pick(backupFile((await otherDeviceBackup()).text));
    const button = await screen.findByRole('button', { name: 'Importă datele' });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(
      Object.assign(new Error('full'), { name: 'QuotaExceededError' }),
    );

    fireEvent.click(button);

    expect((await screen.findByRole('alert')).textContent).toContain('Nu este destul spațiu');
  });
});

describe('privacy', () => {
  it('never touches the network, whatever the user does', async () => {
    const calls = {
      fetch: vi.fn(),
      XMLHttpRequest: vi.fn(),
      WebSocket: vi.fn(),
      EventSource: vi.fn(),
    };
    for (const [name, spy] of Object.entries(calls)) vi.stubGlobal(name, spy);
    const beacon = vi.fn();
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon });

    const db = await renderSection();
    const store = await addStore(db);
    await addReceipt(db, store.id);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Exportă datele' }));
    await screen.findByText(/Am pregătit fișierul/);
    pick(backupFile((await otherDeviceBackup()).text));
    fireEvent.click(await screen.findByRole('button', { name: 'Importă datele' }));
    await screen.findByRole('heading', { name: 'Import terminat' });
    pick(backupFile((await otherDeviceBackup()).text));
    fireEvent.click(await screen.findByRole('radio', { name: /Înlocuiește tot/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Importă datele' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Înlocuiește datele' }));
    await waitFor(() => expect(screen.getByText(/au fost înlocuite/)).toBeTruthy());

    for (const spy of [...Object.values(calls), beacon]) expect(spy).not.toHaveBeenCalled();
    Reflect.deleteProperty(navigator, 'sendBeacon');
  });

  it('exports the same data the storage layer holds', async () => {
    const db = await renderSection();
    const store = await createRecord(db.stores, { chain: 'lidl', name: 'Lidl' });
    await open();

    fireEvent.click(screen.getByRole('button', { name: 'Exportă datele' }));
    await screen.findByText(/Am pregătit fișierul/);

    const { backup } = await exportBackup(db);
    expect((await downloaded()).data['stores']).toEqual(backup.data.stores);
    expect(backup.data.stores.map((s) => s.id)).toEqual([store.id]);
  });
});
