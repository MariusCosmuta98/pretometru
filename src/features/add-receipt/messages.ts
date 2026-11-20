import type { ImportErrorCode, ImportPhase } from '@/import';

export const ERROR_MESSAGES: Record<ImportErrorCode | 'UNKNOWN', string> = {
  UNSUPPORTED_FORMAT: 'Format nesuportat. Alege un PDF, o imagine (JPG, PNG) sau un fișier text.',
  EMPTY_INPUT: 'Fișierul sau textul este gol.',
  FILE_TOO_LARGE: 'Fișierul sau textul este prea mare.',
  NO_TEXT:
    'Nu am găsit text în document. Dacă este un PDF scanat sau o poză, încearcă o captură de ecran sau lipește textul bonului.',
  NOTHING_RECOGNIZED:
    'Nu am recunoscut niciun produs în bon. Încearcă o poză mai clară, lipește textul sau introdu bonul manual.',
  ENGINE_UNAVAILABLE: 'Citirea acestui tip de document nu este disponibilă încă.',
  EXTRACTION_FAILED:
    'Nu am putut citi documentul. Încearcă din nou, cu o poză mai clară, sau lipește textul bonului.',
  SAVE_FAILED: 'Bonul a fost citit, dar nu a putut fi salvat. Încearcă din nou.',
  CANCELLED: 'Citirea a fost anulată.',
  UNKNOWN: 'A apărut o eroare neașteptată. Încearcă din nou.',
};

export const PHASE_LABELS: Record<ImportPhase, string> = {
  reading: 'Se citește fișierul',
  extracting: 'Se extrage textul din bon',
  parsing: 'Se analizează bonul',
  checking: 'Se verifică bonul',
  saving: 'Se salvează ciorna',
};

// Without a connection, a document that cannot be read almost always means that its engine (pdf.js,
// OCR) was never stored on the device: the engines are fetched the first time they are used.
const OFFLINE_ENGINE_MESSAGE =
  'Nu ai internet, iar motorul de citire nu a fost descărcat încă pe acest dispozitiv. Conectează-te o dată la internet sau descarcă motoarele de citire din Setări, la „Offline și stocare”. Între timp poți lipi textul bonului sau îl poți introduce manual.';

export function errorMessage(
  code: ImportErrorCode | 'UNKNOWN' | undefined,
  offline: boolean,
): string {
  const known = code ?? 'UNKNOWN';
  return offline && known === 'EXTRACTION_FAILED' ? OFFLINE_ENGINE_MESSAGE : ERROR_MESSAGES[known];
}
