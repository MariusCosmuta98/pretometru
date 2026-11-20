import { isAdminError, type AdminErrorCode, type StoreMergeResult } from '@/admin';
import type { Store } from '@/domain';
import { chainLabel } from '@/import/stores';
import { plural } from '@/ui/plural';

const TEXT: Partial<Record<AdminErrorCode, string>> = {
  EMPTY_NAME: 'Scrie un nume pentru magazin.',
  NOT_FOUND: 'Magazinul nu mai există: poate a fost șters pe alt dispozitiv.',
  SAME_STORE: 'Alege alt magazin decât cel pe care îl unești.',
  HAS_RECEIPTS: 'Magazinul are bonuri, deci nu poate fi șters. Unește-l cu alt magazin.',
};

/** What went wrong, in words; an unexpected failure (the database) gets a general sentence. */
export function errorText(error: unknown): string {
  return (
    (isAdminError(error) ? TEXT[error.code] : undefined) ??
    'Nu am putut face schimbarea. Nu s-a modificat nimic; încearcă din nou.'
  );
}

/** `Kaufland · Magazin 1234 · Cluj-Napoca`: what tells two stores of a chain apart. */
export function describeStore(store: Store): string {
  return [
    chainLabel(store.chain),
    store.branchCode ? `Magazin ${store.branchCode}` : undefined,
    store.city,
  ]
    .filter((part) => part !== undefined)
    .join(' · ');
}

export const receiptsText = (count: number): string =>
  count === 0 ? 'Niciun bon' : plural(count, 'bon', 'bonuri');

/** What a merge did, for the status line. */
export function mergedText(result: StoreMergeResult): string {
  const from = `Magazinul „${result.merged.name}” a fost unit cu „${result.store.name}”`;
  if (result.receipts === 0) return `${from}.`;
  const verb = result.receipts === 1 ? 'a trecut' : 'au trecut';
  return `${from}: ${plural(result.receipts, 'bon', 'bonuri')} ${verb} la „${result.store.name}”.`;
}
