// @vitest-environment jsdom
// Dexie's live queries need the global IndexedDB, as in the other screens' tests.
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AI_KEY_KEY,
  DEFAULT_MODEL,
  isAiEnabled,
  readAiConfig,
  resetAiServices,
  saveApiKey,
  setAiEnabled,
  setAiServices,
} from '@/ai';
import { googleError, MockGemini } from '@/ai/mock-gemini';
import { FAKE_KEY, TEST_NOW } from '@/ai/testing';
import { features } from '@/app/features';
import { exportBackup, getDb, getKeyValue, type PretometruDB } from '@/storage';
import AiSection from './AiSection';

let db: PretometruDB;
let mock: MockGemini;
let online = true;

beforeEach(async () => {
  online = true;
  db = await getDb();
  await db.syncState.clear();
  mock = new MockGemini({ keys: [FAKE_KEY] });
  setAiServices({ fetch: mock.fetch, now: () => TEST_NOW, isOnline: () => online });
});
afterEach(() => {
  cleanup();
  mock.dispose();
  resetAiServices();
  // Nothing the section sent may be something a browser would have blocked.
  expect(mock.violations).toEqual([]);
});

const field = (name: string) => screen.getByLabelText<HTMLInputElement>(name);
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const typeKey = (value = FAKE_KEY) => {
  fireEvent.change(field('Cheie API Gemini'), { target: { value } });
};

async function open(): Promise<void> {
  render(<AiSection />);
  await screen.findByText(/Citirea cu AI este opțională și oprită implicit/);
}

/** Types the fake key, saves it and waits for the saved view. */
async function saveKey(): Promise<void> {
  await open();
  typeKey();
  fireEvent.click(button('Salvează cheia'));
  await screen.findByText(/Cheia este salvată pe acest dispozitiv \(…0001\)/);
}

describe('the card in Settings', () => {
  it('is a section of the Settings screen, titled "Gemini (opțional)", without a screen of its own', () => {
    const feature = features.find((candidate) => candidate.id === 'ai');
    expect(feature?.routes).toEqual([]);
    expect(feature?.settingsSections?.map((section) => section.title)).toEqual([
      'Gemini (opțional)',
    ]);
  });

  it('starts off and says so: no key, the switch off and unavailable, nothing sent', async () => {
    await open();

    expect(field('Cheie API Gemini').type).toBe('password');
    expect(field('Cheie API Gemini').autocomplete).toBe('off');
    const toggle = screen.getByRole<HTMLInputElement>('switch', { name: /Pornește citirea cu AI/ });
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(true);
    expect(screen.getByText('Salvează mai întâi o cheie.')).toBeTruthy();
    expect(mock.requests).toEqual([]);
  });

  it('warns about the free tier before anything can be switched on, and links to the terms', async () => {
    await open();
    const text = document.body.textContent;
    expect(text).toContain('Nivelul gratuit.');
    expect(text).toContain('îmbunătățească produsele');
    expect(text).toContain('oameni din echipa Google');
    expect(text).toContain('Spațiul Economic European');
    expect(text).toContain('20.11.2026');
    const terms = screen.getByRole('link', { name: 'Termenii Gemini API' });
    expect(terms.getAttribute('href')).toBe('https://ai.google.dev/gemini-api/terms');
    expect(terms.getAttribute('rel')).toContain('noopener');
    for (const link of screen.getAllByRole('link'))
      expect(link.getAttribute('target')).toBe('_blank');
  });
});

describe('the key', () => {
  it('is saved on this device, shown only by its end, and does not switch anything on', async () => {
    await saveKey();

    expect(await getKeyValue(db.syncState, AI_KEY_KEY)).toEqual({ key: FAKE_KEY });
    expect(document.body.textContent).not.toContain(FAKE_KEY);
    expect(screen.getByRole('status').textContent).toContain('rămâne oprită până o pornești');
    const toggle = screen.getByRole<HTMLInputElement>('switch');
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(false);
    expect(mock.requests).toEqual([]);
  });

  it('is refused in Romanian when it cannot be a key', async () => {
    await open();
    typeKey('not a key');
    fireEvent.click(button('Salvează cheia'));

    expect((await screen.findByRole('alert')).textContent).toContain('nu arată ca o cheie API');
    expect(await readAiConfig(db)).toMatchObject({ hasKey: false });
  });

  it('can be replaced', async () => {
    await saveKey();
    fireEvent.click(button('Schimbă cheia'));
    typeKey('replacement-fake-key-for-tests-0002');
    fireEvent.click(button('Salvează cheia'));

    await screen.findByText(/Cheia este salvată pe acest dispozitiv \(…0002\)/);
    expect((await readAiConfig(db)).keyHint).toBe('…0002');
  });

  it('is deleted after a question, and takes the switch with it', async () => {
    await saveKey();
    fireEvent.click(await screen.findByRole('switch'));
    await waitFor(() => expect(screen.getByRole<HTMLInputElement>('switch').checked).toBe(true));

    fireEvent.click(button('Șterge cheia'));
    const question = screen.getByRole('group', { name: 'Ștergi cheia?' });
    fireEvent.click(within(question).getByRole('button', { name: 'Anulează' }));
    expect(screen.queryByRole('group', { name: 'Ștergi cheia?' })).toBeNull();
    expect((await readAiConfig(db)).hasKey).toBe(true);

    fireEvent.click(button('Șterge cheia'));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Ștergi cheia?' })).getByRole('button', {
        name: 'Șterge cheia',
      }),
    );

    await screen.findByLabelText('Cheie API Gemini');
    expect(screen.getByRole('status').textContent).toContain('Cheia a fost ștearsă');
    const toggle = screen.getByRole<HTMLInputElement>('switch');
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(true);
    expect(JSON.stringify(await db.syncState.toArray())).not.toContain(FAKE_KEY);
    expect(mock.requests).toEqual([]);
  });

  it('never reaches a backup', async () => {
    await saveKey();
    const text = JSON.stringify((await exportBackup(db)).backup);
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain(AI_KEY_KEY);
  });
});

describe('the connection test', () => {
  it('asks for the description of the model and says that no receipt was sent', async () => {
    await saveKey();
    fireEvent.click(button('Testează conexiunea'));

    expect((await screen.findByRole('status')).textContent).toBe(
      `Conexiunea funcționează: modelul ${DEFAULT_MODEL} este disponibil. Nu s-a trimis niciun bon.`,
    );
    expect(mock.requests).toEqual([
      expect.objectContaining({
        method: 'GET',
        path: `/v1beta/models/${DEFAULT_MODEL}`,
        headers: { 'x-goog-api-key': FAKE_KEY },
        body: undefined,
      }),
    ]);
  });

  it('works before the feature is switched on, and does not switch it on', async () => {
    await saveKey();
    fireEvent.click(button('Testează conexiunea'));
    await screen.findByText(/Conexiunea funcționează/);
    expect(await isAiEnabled(db)).toBe(false);
  });

  it('says in Romanian what is wrong: a key Google does not know, a model that is gone, no internet, a limit', async () => {
    await saveKey();
    const test = async (expected: RegExp) => {
      fireEvent.click(button('Testează conexiunea'));
      expect((await screen.findByRole('alert')).textContent).toMatch(expected);
    };

    mock.revokeKey(FAKE_KEY);
    await test(/Google nu acceptă cheia API/);

    mock.addKey(FAKE_KEY);
    mock.failNext(/models/, googleError(404, 'NOT_FOUND', 'models/x is not found'));
    await test(/Modelul ales nu există/);

    mock.failNext(
      /models/,
      googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded', [
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34s' },
      ]),
    );
    await test(/Prea multe cereri.*34 s/);

    online = false;
    await test(/Nu ești conectat la internet/);
  });
});

describe('the switch', () => {
  it('turns the reading on and off, and the choice is kept', async () => {
    await saveKey();
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(screen.getByRole<HTMLInputElement>('switch').checked).toBe(true));
    expect(await isAiEnabled(db)).toBe(true);

    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(screen.getByRole<HTMLInputElement>('switch').checked).toBe(false));
    expect(await isAiEnabled(db)).toBe(false);
    expect(mock.requests).toEqual([]);
  });

  it('shows a feature that was already on, without asking Google anything', async () => {
    await saveApiKey(db, FAKE_KEY);
    await setAiEnabled(db, true);
    await open();
    await waitFor(() => expect(screen.getByRole<HTMLInputElement>('switch').checked).toBe(true));
    expect(mock.requests).toEqual([]);
  });
});

describe('the model', () => {
  it('is the default, can be changed to another valid id and refuses an invalid one', async () => {
    await open();
    fireEvent.click(screen.getByText('Setări avansate'));
    expect(field('Model Gemini').value).toBe(DEFAULT_MODEL);

    fireEvent.change(field('Model Gemini'), { target: { value: 'gemini:generateContent' } });
    fireEvent.click(button('Salvează modelul'));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Numele modelului nu este valid',
    );
    expect((await readAiConfig(db)).model).toBe(DEFAULT_MODEL);

    fireEvent.change(field('Model Gemini'), { target: { value: 'gemini-3.6-flash' } });
    fireEvent.click(button('Salvează modelul'));
    expect((await screen.findByRole('status')).textContent).toBe('Modelul a fost salvat.');
    await waitFor(async () => expect((await readAiConfig(db)).model).toBe('gemini-3.6-flash'));

    fireEvent.click(button('Folosește modelul implicit'));
    await waitFor(async () => expect((await readAiConfig(db)).model).toBe(DEFAULT_MODEL));
    expect(field('Model Gemini').value).toBe(DEFAULT_MODEL);
  });
});
