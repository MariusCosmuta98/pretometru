// @vitest-environment jsdom
// Dexie's live queries need the global IndexedDB, as in the product screens' tests.
import 'fake-indexeddb/auto';
import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createRecord, getKeyValue } from '@/storage';
import { getSyncServices, lockToken, readConnection, runSync, saveConnection } from '@/sync';
import { at, FULL_NAME, makeDevice, OWNER, REPO, seedSample, TOKEN } from '@/sync/testing';
import { formatWhen } from './format';
import { press, syncHarness, typeInto, waitFor, within } from './testing';

vi.setConfig({ testTimeout: 30_000 });

const harness = syncHarness();

const SECOND_TOKEN = 'second-fake-token';

/** The panel of a connected device appears once the stored state has been read. */
async function pressWhenReady(section: HTMLElement, name: string) {
  fireEvent.click(await within(section).findByRole('button', { name }));
}

/** Types a token and a repository into the onboarding form and starts the checks. */
function check(section: HTMLElement, options: { token?: string; repo?: string } = {}) {
  typeInto(section, 'Token GitHub', options.token ?? TOKEN);
  if (options.repo !== undefined) typeInto(section, 'Depozit', options.repo);
  press(section, 'Verifică conexiunea');
}

/** Connects this device without the screen, and syncs once, as a user who finished the onboarding. */
async function connectDevice(passphrase?: string) {
  await saveConnection(
    harness.db,
    { owner: OWNER, repo: REPO, token: TOKEN, passphrase },
    getSyncServices(),
  );
  await runSync();
}

describe('the onboarding', () => {
  it('explains what to create on GitHub: a private repository and a token limited to it', async () => {
    const section = await harness.renderSettings();

    const text = section.textContent;
    expect(text).toContain('pretometru-data');
    expect(text).toContain('privat');
    expect(text).toContain('Add a README file');
    expect(text).toContain('Only select repositories');
    expect(text).toContain('Contents');
    expect(text).toContain('Read and write');
    expect(within(section).getByLabelText('Token GitHub')).toHaveProperty('type', 'password');
    expect(within(section).getByLabelText('Depozit')).toHaveProperty('value', 'pretometru-data');
    for (const link of within(section).getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^https:\/\/github\.com\//);
      expect(link.getAttribute('rel')).toContain('noopener');
    }
  });

  it('walks from the token to a first sync that uploads this device', async () => {
    await seedSample(harness.db);
    const section = await harness.renderSettings();

    check(section);
    // The summary appears once every check has passed.
    expect(await within(section).findByText(/nu conține încă date Pretometru/)).toBeTruthy();
    const checks = within(section).getByRole('list', { name: 'Verificări' });
    expect(
      within(checks)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      '✓Reușit: Tokenul este valid',
      '✓Reușit: Depozitul există și tokenul are acces la el',
      '✓Reușit: Depozitul este privat',
      '✓Reușit: Tokenul poate citi și scrie (Contents: Read and write)',
      '✓Reușit: Conținutul depozitului a fost citit',
    ]);
    // Nothing is saved before the user confirms.
    expect(await harness.db.syncState.count()).toBe(0);

    press(section, 'Conectează și încarcă datele');

    expect(await within(section).findByText('ana/pretometru-data')).toBeTruthy();
    expect(
      await within(section).findByText(/Prima sincronizare: \d+ înregistrări trimise/),
    ).toBeTruthy();
    expect(harness.github.files(FULL_NAME).has('data/products/2026-11.json')).toBe(true);
    expect((await harness.db.syncState.get('sync.token'))?.value).toEqual({
      kind: 'plain',
      token: TOKEN,
    });
    expect(section.textContent).not.toContain(TOKEN);
  });

  it('merges when the repository already holds data, and says so before it does', async () => {
    const phone = await makeDevice(harness.github, 'PHONE1');
    await seedSample(phone.db);
    await phone.sync();
    const section = await harness.renderSettings();

    check(section);

    expect(await within(section).findByText(/conține deja date Pretometru/)).toBeTruthy();
    expect(
      within(section).getByText(
        /pentru fiecare înregistrare rămâne varianta modificată cel mai recent/,
      ),
    ).toBeTruthy();
    press(section, 'Conectează și îmbină datele');

    await waitFor(async () => expect(await harness.db.products.count()).toBe(1));
    expect(await within(section).findByText(/înregistrări primite/)).toBeTruthy();
  });

  it('accepts the address of the repository as well as its name', async () => {
    const section = await harness.renderSettings();
    check(section, { repo: 'https://github.com/ana/pretometru-data' });
    expect(await within(section).findByText(/nu conține încă date Pretometru/)).toBeTruthy();
  });

  it('warns about a classic token, which reaches every repository of its owner', async () => {
    const classic = ['ghp', 'x'.repeat(8)].join('_');
    harness.github.addToken(classic, OWNER, { [FULL_NAME]: 'write' });
    const section = await harness.renderSettings();

    check(section, { token: classic });

    expect(await within(section).findByText(/Ai folosit un token clasic/)).toBeTruthy();
  });
});

describe('what the onboarding says when something is wrong', () => {
  it('asks for a token before it asks GitHub anything', async () => {
    const section = await harness.renderSettings();
    press(section, 'Verifică conexiunea');
    expect((await within(section).findByRole('alert')).textContent).toBe('Lipește tokenul GitHub.');
    expect(harness.github.requests).toEqual([]);
  });

  it('refuses a repository name that is not one, without a request', async () => {
    const section = await harness.renderSettings();
    check(section, { repo: 'a/b/c' });
    expect((await within(section).findByRole('alert')).textContent).toContain(
      'Numele depozitului nu este valid',
    );
    expect(harness.github.requests).toEqual([]);
  });

  it('reports a token GitHub does not accept', async () => {
    const section = await harness.renderSettings();
    check(section, { token: 'a-token-nobody-issued' });
    expect((await within(section).findByRole('alert')).textContent).toContain(
      'GitHub nu acceptă tokenul',
    );
    expect(within(section).queryByRole('button', { name: /Conectează/ })).toBeNull();
  });

  it('reports a repository that does not exist or that the token does not include', async () => {
    const section = await harness.renderSettings();
    check(section, { repo: 'nu-exista' });
    expect((await within(section).findByRole('alert')).textContent).toContain(
      'nu există sau tokenul nu are acces la el',
    );
  });

  it('refuses a public repository, and shows which check it failed', async () => {
    harness.github.setPrivate(FULL_NAME, false);
    const section = await harness.renderSettings();

    check(section);

    expect((await within(section).findByRole('alert')).textContent).toContain(
      'Depozitul este public',
    );
    const items = within(section)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(items.at(-1)).toBe('✗Eșuat: Depozitul este privat');
    expect(within(section).queryByRole('button', { name: /Conectează/ })).toBeNull();
    expect(harness.github.writes).toEqual([]);
    expect(await harness.db.syncState.count()).toBe(0);
  });

  it('reports a token that may only read', async () => {
    await harness.world({ permission: 'read' });
    const section = await harness.renderSettings();
    check(section);
    expect((await within(section).findByRole('alert')).textContent).toContain(
      'Tokenul nu are voie să scrie în depozit',
    );
  });

  it('reports that the device is offline', async () => {
    harness.install({ isOnline: () => false });
    const section = await harness.renderSettings();
    check(section);
    expect((await within(section).findByRole('alert')).textContent).toContain(
      'Nu ești conectat la internet',
    );
    expect(harness.github.requests).toEqual([]);
  });

  it('reports a rate limit and when to try again', async () => {
    harness.github.failNext(/./, {
      status: 403,
      headers: { 'retry-after': '600' },
      body: { message: 'You have exceeded a secondary rate limit.' },
    });
    const section = await harness.renderSettings();
    check(section);
    expect((await within(section).findByRole('alert')).textContent).toBe(
      `GitHub a limitat temporar cererile. Poți încerca din nou după ${formatWhen('2026-11-20T12:10:00.000Z')}.`,
    );
  });

  it('starts over when a field is edited after a failed check', async () => {
    const section = await harness.renderSettings();
    check(section, { token: 'a-token-nobody-issued' });
    await within(section).findByRole('alert');

    typeInto(section, 'Token GitHub', TOKEN);
    expect(within(section).queryByRole('alert')).toBeNull();
    press(section, 'Verifică conexiunea');
    expect(await within(section).findByText(/nu conține încă date Pretometru/)).toBeTruthy();
  });
});

describe('protecting the token with a passphrase', () => {
  it('needs two matching passphrases of a decent length, and stores the token encrypted', async () => {
    const section = await harness.renderSettings();
    typeInto(section, 'Token GitHub', TOKEN);
    fireEvent.click(within(section).getByLabelText('Protejează tokenul cu o parolă (opțional)'));

    typeInto(section, 'Parolă', 'scurta');
    typeInto(section, 'Repetă parola', 'scurta');
    press(section, 'Verifică conexiunea');
    expect((await within(section).findByRole('alert')).textContent).toContain(
      'cel puțin 8 caractere',
    );

    typeInto(section, 'Parolă', 'o parolă lungă');
    typeInto(section, 'Repetă parola', 'altă parolă lungă');
    press(section, 'Verifică conexiunea');
    expect((await within(section).findByRole('alert')).textContent).toBe(
      'Parolele nu se potrivesc.',
    );
    expect(harness.github.requests).toEqual([]);

    typeInto(section, 'Repetă parola', 'o parolă lungă');
    press(section, 'Verifică conexiunea');
    fireEvent.click(await within(section).findByRole('button', { name: /Conectează/ }));
    await within(section).findByText('ana/pretometru-data');

    const stored = JSON.stringify(await harness.db.syncState.toArray());
    expect(stored).not.toContain(TOKEN);
    expect(stored).toContain('PBKDF2-SHA256');
  });

  it('asks for the passphrase again after a restart, and refuses a wrong one', async () => {
    await connectDevice('o parolă lungă');
    const section = await harness.renderSettings();
    expect(within(section).queryByLabelText('Parola tokenului')).toBeNull();

    act(() => lockToken()); // what closing the app does to a token that was only in memory

    expect(await within(section).findByLabelText('Parola tokenului')).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Sincronizează acum' })).toHaveProperty(
      'disabled',
      true,
    );

    typeInto(section, 'Parola tokenului', 'altă parolă');
    press(section, 'Deblochează');
    expect((await within(section).findByRole('alert')).textContent).toBe('Parola nu este corectă.');

    typeInto(section, 'Parola tokenului', 'o parolă lungă');
    press(section, 'Deblochează');
    await waitFor(() => expect(within(section).queryByLabelText('Parola tokenului')).toBeNull());
    expect(within(section).getByRole('button', { name: 'Sincronizează acum' })).toHaveProperty(
      'disabled',
      false,
    );
  });
});

describe('a connected device', () => {
  it('shows the repository, the last sync and nothing waiting', async () => {
    await seedSample(harness.db);
    await connectDevice();

    const section = await harness.renderSettings();

    expect(await within(section).findByText('ana/pretometru-data')).toBeTruthy();
    expect(within(section).getByText(/Ultima sincronizare reușită:/).textContent).toMatch(
      new RegExp(
        `${formatWhen('2026-11-20T12:00:00.000Z')}\\. Prima sincronizare: \\d+ înregistrări trimise\\.`,
      ),
    );
    expect(within(section).queryByText(/modificări care nu au fost încă trimise/)).toBeNull();
    expect(section.textContent).not.toContain(TOKEN);
  });

  it('sends what changed with "Sincronizează acum", and says it is waiting before that', async () => {
    await seedSample(harness.db);
    await connectDevice();
    const section = await harness.renderSettings();
    await within(section).findByText(/Ultima sincronizare reușită/);

    await createRecord(
      harness.db.stores,
      { chain: 'metro', name: 'METRO Cluj' },
      at('2026-11-20T12:30:00.000Z'),
    );
    expect(
      await within(section).findByText(/Ai modificări care nu au fost încă trimise/),
    ).toBeTruthy();

    press(section, 'Sincronizează acum');

    expect(await within(section).findByText(/1 înregistrare trimisă\./)).toBeTruthy();
    await waitFor(() =>
      expect(within(section).queryByText(/modificări care nu au fost încă trimise/)).toBeNull(),
    );
    expect(harness.github.files(FULL_NAME).get('data/stores/2026-11.json')).toContain('METRO Cluj');
  });

  it('shows that it is syncing, and which step, while it waits for GitHub', async () => {
    await connectDevice();
    const section = await harness.renderSettings();
    await within(section).findByText(/Ultima sincronizare reușită/);
    // The gate is open from the start of the test on: a request that reaches the hook late, after
    // the test failed, must not hang a sync that would then block every later test.
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness.github.before(/^GET .*\/git\/trees\//, () => gate);

    press(section, 'Sincronizează acum');

    try {
      expect(await within(section).findByText('Se verifică depozitul…')).toBeTruthy();
      expect(within(section).getByRole('button', { name: 'Sincronizează acum' })).toHaveProperty(
        'disabled',
        true,
      );
    } finally {
      release();
    }
    expect(await within(section).findByText(/Totul era deja la zi\./)).toBeTruthy();
  });

  it('keeps the last success on screen when a sync fails, and says why', async () => {
    await connectDevice();
    const section = await harness.renderSettings();
    await within(section).findByText(/Ultima sincronizare reușită/);

    harness.github.revoke(TOKEN);
    press(section, 'Sincronizează acum');

    expect((await within(section).findByRole('alert')).textContent).toContain(
      'GitHub nu acceptă tokenul',
    );
    expect(within(section).getByText(/Ultima sincronizare reușită/)).toBeTruthy();
    // A revoked token is not fixed by trying again, so the automatic sync waits for a manual one.
    expect(within(section).getByText(/Sincronizarea automată este oprită/)).toBeTruthy();
  });

  it('does not call a temporary failure a reason to stop the automatic sync', async () => {
    await connectDevice();
    const section = await harness.renderSettings();
    await within(section).findByText(/Ultima sincronizare reușită/);

    harness.github.setOffline(true);
    press(section, 'Sincronizează acum');

    expect((await within(section).findByRole('alert')).textContent).toContain(
      'Nu am putut ajunge la GitHub',
    );
    expect(within(section).queryByText(/Sincronizarea automată este oprită/)).toBeNull();
  });

  it('explains a branch that keeps moving because other devices sync at the same time', async () => {
    await connectDevice();
    const section = await harness.renderSettings();
    await within(section).findByText(/Ultima sincronizare reușită/);
    await createRecord(
      harness.db.stores,
      { chain: 'metro', name: 'METRO Cluj' },
      at('2026-11-20T12:30:00.000Z'),
    );
    let pushes = 0;
    harness.github.before(
      /^PATCH .*\/git\/refs\//,
      async () => {
        pushes += 1;
        await harness.github.push(FULL_NAME, { 'notes.txt': `change ${pushes}` });
      },
      10,
    );

    press(section, 'Sincronizează acum');

    expect((await within(section).findByRole('alert')).textContent).toContain(
      'Alt dispozitiv a sincronizat în același timp',
    );
  });

  it('remembers the choice of syncing automatically or not', async () => {
    await connectDevice();
    const section = await harness.renderSettings();
    const box = await within(section).findByLabelText(/Sincronizare automată/);
    expect(box).toHaveProperty('checked', true);

    fireEvent.click(box);

    await waitFor(async () => expect((await readConnection(harness.db))?.auto).toBe(false));
    await waitFor(() =>
      expect(within(section).getByLabelText(/Sincronizare automată/)).toHaveProperty(
        'checked',
        false,
      ),
    );
  });

  it('replaces the token without losing the connection', async () => {
    await connectDevice();
    harness.github.addToken(SECOND_TOKEN, OWNER, { [FULL_NAME]: 'write' });
    const section = await harness.renderSettings();

    await pressWhenReady(section, 'Schimbă tokenul');
    expect(within(section).getByLabelText('Depozit')).toHaveProperty(
      'value',
      'ana/pretometru-data',
    );
    typeInto(section, 'Token GitHub', SECOND_TOKEN);
    press(section, 'Verifică conexiunea');
    fireEvent.click(
      await within(section).findByRole('button', { name: 'Salvează și sincronizează' }),
    );

    await waitFor(async () =>
      expect((await harness.db.syncState.get('sync.token'))?.value).toEqual({
        kind: 'plain',
        token: SECOND_TOKEN,
      }),
    );
    expect((await readConnection(harness.db))?.deviceId).toBe('DEV001');
  });

  it('disconnects after a confirmation, and takes the token off the device', async () => {
    await seedSample(harness.db);
    await connectDevice();
    const section = await harness.renderSettings();

    await pressWhenReady(section, 'Deconectează');
    expect(
      within(section).getByText(/Datele de pe dispozitiv și cele din GitHub rămân neschimbate/),
    ).toBeTruthy();
    press(section, 'Da, deconectează');

    expect(await within(section).findByLabelText('Token GitHub')).toBeTruthy();
    expect(await getKeyValue(harness.db.syncState, 'sync.token')).toBeUndefined();
    expect(JSON.stringify(await harness.db.syncState.toArray())).not.toContain(TOKEN);
    // The data on both sides is left as it was.
    expect(await harness.db.products.count()).toBe(1);
    expect(harness.github.files(FULL_NAME).has('data/products/2026-11.json')).toBe(true);
  });

  it('can change its mind about disconnecting', async () => {
    await connectDevice();
    const section = await harness.renderSettings();
    await pressWhenReady(section, 'Deconectează');
    press(section, 'Anulează');
    expect(within(section).queryByRole('group', { name: 'Confirmă deconectarea' })).toBeNull();
    expect(await readConnection(harness.db)).toBeDefined();
    expect(within(section).getByRole('button', { name: 'Sincronizează acum' })).toBeTruthy();
  });
});
