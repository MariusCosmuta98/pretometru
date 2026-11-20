/**
 * Test-only helpers for the AI reading: a fake photo, services wired to the in-memory Gemini, and
 * the JSON a perfect model would answer for a receipt. Everything is fake: never use a real key.
 * Never import this from application code.
 */
import type { ParsedReceipt } from '@/domain';
import type { PretometruDB } from '@/storage';
import { setAiServices } from './services';
import type { PreparedImage } from './types';
import type { MockGemini } from './mock-gemini';

/** Not a key of any service: it is only checked by the in-memory Gemini. */
export const FAKE_KEY = 'fake-gemini-key-for-tests-0001';

/** 2026-11-20 12:00 in Bucharest, like the import tests (the Lidl sample is dated after it). */
export const TEST_NOW = new Date('2026-11-20T10:00:00.000Z');

/** The first bytes of a JPEG: all the in-memory Gemini looks at. */
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

export function fakePreparedImage(): PreparedImage {
  return {
    mimeType: 'image/jpeg',
    base64: btoa(String.fromCharCode(...JPEG_BYTES)),
    width: 640,
    height: 1280,
    bytes: JPEG_BYTES.length,
  };
}

/** A photo as the user picked it: bytes the fake `prepareImage` never looks at. */
export function fakePhoto(name = 'bon.jpg'): File {
  return new File([JPEG_BYTES], name, { type: 'image/jpeg' });
}

/**
 * Points the module at a test database and an in-memory Gemini (the real photo preparation is
 * replaced too: jsdom has no canvas). Undo with `resetAiServices()`.
 */
export function useMockGemini(db: PretometruDB, mock: MockGemini, online = true): void {
  setAiServices({
    getDb: () => Promise.resolve(db),
    fetch: mock.fetch,
    now: () => TEST_NOW,
    isOnline: () => online,
    prepareImage: () => Promise.resolve(fakePreparedImage()),
  });
}

const lei = (bani: number): number => bani / 100;

/**
 * The JSON a perfect model answers for a receipt whose truth is known: the fixtures' ground truth
 * run backwards through the schema of `prompt.ts`. VAT, section headers and the pack size are not
 * part of the ask (the pack is derived from the name), so they are not in the answer.
 */
export function answerFromReceipt(receipt: ParsedReceipt): string {
  const { totals } = receipt;
  return JSON.stringify({
    ...(receipt.storeName === undefined ? {} : { store: receipt.storeName }),
    chain: receipt.chain,
    ...(receipt.branch?.city === undefined ? {} : { city: receipt.branch.city }),
    ...(receipt.branch?.code === undefined ? {} : { storeCode: receipt.branch.code }),
    documentType: receipt.docType,
    ...(receipt.documentNo === undefined ? {} : { documentNumber: receipt.documentNo }),
    ...(receipt.purchasedAt === undefined ? {} : { purchasedAt: receipt.purchasedAt }),
    lines: receipt.lines.map((line) => ({
      name: line.rawName,
      quantity: line.qty,
      unit: line.qtyUnit,
      ...(line.unitPriceBani === undefined ? {} : { unitPrice: lei(line.unitPriceBani) }),
      ...(line.discountBani === undefined ? {} : { discount: lei(line.discountBani) }),
      total: lei(line.lineTotalBani),
      kind: line.kind,
      ...(line.ean === undefined ? {} : { ean: line.ean }),
    })),
    total: lei(totals.grandTotalBani),
    ...(totals.paidBani === undefined ? {} : { paid: lei(totals.paidBani) }),
  });
}
