import type { ParsedReceipt } from '@/domain';

/** Printed VAT totals per rate, as the parser read them. */
export type VatTotals = NonNullable<ParsedReceipt['totals']['vat']>;

/** Source region of a line, in image pixels. */
export interface LineBox {
  x: number;
  y: number;
  w: number;
  h: number;
  page?: number;
}

/** What a parsed line knows that the persisted `Line` has no place for. */
export interface LineMeta {
  unitPriceBani?: number;
  vatClass?: string;
  confidence?: number;
  bbox?: LineBox;
  raw?: string;
}

/**
 * The in-memory companion of a receipt under review: the original image (for line crops) and the
 * parsed details the database does not keep. Originals are never persisted or synced; closing the
 * tab drops them, and the review then simply works without crops.
 */
export interface ReviewSession {
  original?: Blob;
  vat?: VatTotals;
  /** By line id. */
  lines: Readonly<Record<string, LineMeta>>;
}

// A phone photo is a few MB; keeping every image of a long session would add up.
const MAX_SESSIONS = 5;
const sessions = new Map<string, ReviewSession>();

export function openReviewSession(receiptId: string, session: ReviewSession): void {
  sessions.delete(receiptId);
  sessions.set(receiptId, session);
  for (const oldest of sessions.keys()) {
    if (sessions.size <= MAX_SESSIONS) break;
    sessions.delete(oldest);
  }
}

/** The session of a receipt, marked as the most recently used. */
export function getReviewSession(receiptId: string): ReviewSession | undefined {
  const session = sessions.get(receiptId);
  if (session) {
    sessions.delete(receiptId);
    sessions.set(receiptId, session);
  }
  return session;
}

export function closeReviewSession(receiptId: string): void {
  sessions.delete(receiptId);
}

export function clearReviewSessions(): void {
  sessions.clear();
}
