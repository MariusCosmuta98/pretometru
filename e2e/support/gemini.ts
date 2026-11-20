import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { SEED_CATEGORIES } from '../../src/domain/seed.ts';
import { makeLine, makeReceipt, makeStore } from '../../src/domain/testing.ts';
import type { MockGemini } from '../../src/ai/mock-gemini.ts';

/** Not a key of any service: the in-memory Gemini only checks that it is the one it was told about. */
export const FAKE_KEY = 'fake-gemini-key-for-e2e-0001';

export const GEMINI_HOST = 'generativelanguage.googleapis.com';

// Headers a browser adds by itself: everything else is what the app set, and goes to the mock.
const BROWSER_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'connection',
  'content-length',
  'cookie',
  'host',
  'origin',
  'pragma',
  'priority',
  'referer',
  'user-agent',
]);

/**
 * Answers every request to Google from the in-memory Gemini, the way the browser would see the
 * real one: only the headers the app set are passed on, and CORS headers are added (Playwright
 * answers the preflight itself, so the mock's own tests check the header allow-list). Returns what
 * the page asked Google for, whatever the mock did with it.
 */
export async function serveGemini(page: Page, mock: MockGemini): Promise<string[]> {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname === GEMINI_HOST) {
      seen.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  await page.route(`https://${GEMINI_HOST}/**`, async (route) => {
    const request = route.request();
    const sent = request.headers();
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(sent)) {
      if (!BROWSER_HEADERS.has(name) && !name.startsWith('sec-')) headers[name] = value;
    }
    const response = await mock.fetch(request.url(), {
      method: request.method(),
      headers,
      body: request.postData() ?? undefined,
    });
    await route.fulfill({
      status: response.status,
      headers: {
        ...Object.fromEntries(response.headers),
        'access-control-allow-origin': sent['origin'] ?? '*',
      },
      body: await response.text(),
    });
  });
  return seen;
}

/** The chunks of the AI engine: fetched by the first reading or connection test, never before. */
export const isAiEngineChunk = (url: string): boolean =>
  /\/assets\/(client|read|connection)-[\w-]+\.js$/.test(new URL(url).pathname);

interface TruthLine {
  rawName: string;
  kind: string;
  qty: number;
  qtyUnit: string;
  unitPriceBani?: number;
  discountBani?: number;
  lineTotalBani: number;
  ean?: string;
}

interface Truth {
  chain: string;
  storeName?: string;
  branch?: { city?: string; code?: string };
  docType: string;
  documentNo?: string;
  purchasedAt?: string;
  totals: { grandTotalBani: number; paidBani?: number };
  lines: TruthLine[];
}

/** The JSON a perfect model answers for the Lidl receipt of the fixtures (the ground truth, run through the schema). */
export function lidlAnswer(): string {
  const path = '../../tests/fixtures/real/lidl-2026-12-29/expected.json';
  const truth = JSON.parse(
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'),
  ) as Truth;
  return JSON.stringify({
    store: truth.storeName,
    chain: truth.chain,
    city: truth.branch?.city,
    documentType: truth.docType,
    purchasedAt: truth.purchasedAt,
    lines: truth.lines.map((line) => ({
      name: line.rawName,
      quantity: line.qty,
      unit: line.qtyUnit,
      unitPrice: line.unitPriceBani === undefined ? undefined : line.unitPriceBani / 100,
      total: line.lineTotalBani / 100,
      kind: line.kind,
    })),
    total: truth.totals.grandTotalBani / 100,
    paid: truth.totals.paidBani === undefined ? undefined : truth.totals.paidBani / 100,
  });
}

/**
 * A draft read from a photo, as the OCR would have left it, with a price that is wrong (the lines
 * add up to 51,67 against a printed 61,67), written into the app's IndexedDB. The photo itself is
 * not in memory, which is what the review sees after a reload. The page must have loaded: the app
 * creates the schema. Returns the receipt id (`#/bonuri/<id>`).
 */
export async function seedImageDraft(page: Page): Promise<string> {
  const store = makeStore({ chain: 'lidl', name: 'Lidl Cluj-Napoca', branchCode: undefined });
  const receipt = makeReceipt({
    storeId: store.id,
    purchasedAt: '2026-11-03T16:57',
    totalBani: 6167,
    status: 'draft',
    source: { kind: 'image', fileName: 'bon.jpg' },
    extraction: { engine: 'tesseract', parser: 'lidl', version: '1.0.0', warnings: [] },
  });
  const names: Array<[string, number]> = [
    ['Saci menajeri 60L', 810],
    ['Mascarpone', 1849],
    ['Buchet lalele 7 fire', 1999],
    ['Servetele umede univ.', 599],
  ];
  const lines = names.map(([rawName, lineTotalBani], idx) =>
    makeLine({
      receiptId: receipt.id,
      idx,
      rawName,
      qty: 1,
      lineTotalBani,
      paidUnitBani: lineTotalBani,
      pricePerBaseMilliBani: lineTotalBani * 1000,
      categoryId: SEED_CATEGORIES[4]?.id ?? '',
    }),
  );

  await page.evaluate(
    async (data) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('pretometru');
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(request.error ?? new Error('The database did not open'));
        };
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(Object.keys(data), 'readwrite');
        for (const [table, rows] of Object.entries(data)) {
          for (const row of rows) transaction.objectStore(table).put(row);
        }
        transaction.oncomplete = () => {
          resolve();
        };
        transaction.onerror = () => {
          reject(transaction.error ?? new Error('The seed was not written'));
        };
      });
      db.close();
    },
    { stores: [store], receipts: [receipt], lines },
  );
  return receipt.id;
}

/** A PNG of `width` x `height` pixels with a few lines of text, drawn in the browser: a big phone photo. */
export async function bigPhoto(page: Page, width: number, height: number): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w ?? 0;
      canvas.height = h ?? 0;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No canvas');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#000000';
      context.font = '60px "Courier New", Courier, monospace';
      [
        'LIDL',
        'Saci menajeri 60L    8,10',
        'Mascarpone          18,49',
        'TOTAL               61,67',
      ].forEach((row, index) => {
        context.fillText(row, 120, 160 + index * 90);
      });
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png');
      });
      if (!blob) throw new Error('The canvas could not be encoded');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    [width, height] as const,
  );
  return Buffer.from(base64, 'base64');
}

/** What the app's `syncState` says about the feature (never the key itself): for a test that waits for a write to land. */
export async function aiSettings(
  page: Page,
): Promise<{ enabled: boolean | undefined; hasKey: boolean }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pretometru');
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('The database did not open'));
      };
    });
    const read = (key: string) =>
      new Promise<{ value: unknown } | undefined>((resolve, reject) => {
        const request = db.transaction('syncState').objectStore('syncState').get(key);
        request.onsuccess = () => {
          resolve(request.result as { value: unknown } | undefined);
        };
        request.onerror = () => {
          reject(request.error ?? new Error('Could not read syncState'));
        };
      });
    const config = (await read('ai.gemini'))?.value as { enabled?: boolean } | null | undefined;
    const key = (await read('ai.gemini.key'))?.value;
    db.close();
    return { enabled: config?.enabled, hasKey: key !== undefined && key !== null };
  });
}

/** What this browser decodes the JPEG of a request to: the size that actually left the device. */
export async function sizeOfJpeg(
  page: Page,
  bytes: Uint8Array,
): Promise<{ width: number; height: number }> {
  return page.evaluate(async (numbers) => {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(numbers)], { type: 'image/jpeg' }),
    );
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }, Array.from(bytes));
}
