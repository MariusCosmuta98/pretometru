import type {
  BackupRefusal,
  BackupTable,
  BackupWarning,
  DanglingSubject,
  DanglingTarget,
  ImportSummary,
  TableCount,
} from '@/admin';
import { plural } from '@/ui/plural';
import { formatBytes } from './format';

/** What each kind of record is called, as a heading of the counts. */
export const TABLE_NAMES: Record<BackupTable, string> = {
  receipts: 'Bonuri',
  lines: 'Linii de bon',
  products: 'Produse',
  categories: 'Categorii',
  stores: 'Magazine',
  aliases: 'Nume memorate',
  lists: 'Liste de cumpărături',
  listItems: 'Articole din liste',
  settings: 'Setări',
};

/** What a table is called; an unknown one (a later app version) keeps its own name. */
export const tableName = (table: string): string =>
  (TABLE_NAMES as Readonly<Record<string, string>>)[table] ?? table;

const SUMMARY: ReadonlyArray<{ table: BackupTable; one: string; other: string }> = [
  { table: 'receipts', one: 'bon', other: 'bonuri' },
  { table: 'products', one: 'produs', other: 'produse' },
  { table: 'stores', one: 'magazin', other: 'magazine' },
  { table: 'lists', one: 'listă', other: 'liste' },
];

/** `120 de bonuri, 340 de produse și 3 magazine`: what the user would recognise as their data. */
export function describeCounts(counts: readonly TableCount[]): string {
  const parts = SUMMARY.flatMap(({ table, one, other }) => {
    const live = counts.find((count) => count.table === table)?.live ?? 0;
    return live > 0 ? [plural(live, one, other)] : [];
  });
  if (parts.length === 0) return 'nicio dată';
  return parts.length === 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} și ${parts.at(-1) ?? ''}`;
}

export interface Message {
  /** The sentence the user reads. */
  text: string;
  /** What to do about it. */
  hint?: string;
  /** Technical reasons (in English, from the validator) for whoever wants to know. */
  details?: readonly string[];
}

/** Why a file was refused, in words; nothing was imported. */
export function refusalMessage(refusal: BackupRefusal): Message {
  switch (refusal.code) {
    case 'unreadable':
      return {
        text: 'Fișierul nu a putut fi citit.',
        hint: 'Alege-l din nou sau încearcă alt fișier.',
      };
    case 'too-large':
      return {
        text: `Fișierul este prea mare pentru o copie de siguranță (${formatBytes(refusal.bytes)}; limita este ${formatBytes(refusal.limit)}).`,
        hint: 'Alege fișierul exportat din această aplicație.',
      };
    case 'not-json':
      return {
        text: 'Fișierul nu este o copie de siguranță Pretometru: nu are formatul așteptat (poate este incomplet sau stricat).',
        hint: 'Alege un fișier cu numele terminat în .pretometru-backup.json, exportat din această aplicație.',
      };
    case 'not-backup':
      return {
        text: 'Fișierul nu este o copie de siguranță Pretometru.',
        hint: 'Alege un fișier cu numele terminat în .pretometru-backup.json, exportat din această aplicație.',
      };
    case 'newer-version':
      return {
        text: `Fișierul a fost făcut de o versiune mai nouă a aplicației (format ${refusal.formatVersion}), iar aceasta înțelege formatul ${refusal.supportedVersion}.`,
        hint: 'Actualizează aplicația și încearcă din nou. Nu s-a importat nimic.',
      };
    case 'invalid':
      return {
        text: 'Fișierul pare stricat sau modificat: conținutul lui nu respectă formatul copiei de siguranță.',
        hint: 'Nu s-a importat nimic. Încearcă un alt fișier sau exportă din nou.',
        details: refusal.details,
      };
  }
}

// The verb agrees with the number: `1 bon face`, `3 bonuri fac`.
const SUBJECTS: Record<DanglingSubject, [one: string, other: string]> = {
  receipts: ['bon face', 'bonuri fac'],
  lines: ['linie de bon face', 'linii de bon fac'],
  products: ['produs face', 'produse fac'],
  aliases: ['nume memorat face', 'nume memorate fac'],
  categories: ['categorie face', 'categorii fac'],
  listItems: ['articol dintr-o listă face', 'articole din liste fac'],
};

const TARGETS: Record<DanglingTarget, string> = {
  store: 'un magazin',
  receipt: 'un bon',
  product: 'un produs',
  category: 'o categorie',
  parentCategory: 'o categorie-părinte',
  list: 'o listă',
};

/** One sentence per thing worth knowing about a valid file. */
export function warningText(warning: BackupWarning): string {
  if (warning.kind === 'other') return warning.text;
  const [one, other] = SUBJECTS[warning.subject];
  return `${plural(warning.count, one, other)} trimitere la ${TARGETS[warning.target]} care nu este în fișier.`;
}

/** What an import did, in sentences. */
export function resultText(summary: ImportSummary): string {
  if (summary.mode === 'replace') {
    return `Datele de pe acest dispozitiv au fost înlocuite cu cele din fișier (${plural(summary.added, 'înregistrare', 'înregistrări')}).`;
  }
  if (summary.added === 0 && summary.updated === 0) {
    return 'Nu s-a schimbat nimic: tot ce era în fișier există deja pe acest dispozitiv, în aceeași variantă sau într-una mai nouă.';
  }
  const changes = [
    summary.added > 0 ? plural(summary.added, 'înregistrare nouă', 'înregistrări noi') : undefined,
    summary.updated > 0
      ? plural(summary.updated, 'înregistrare actualizată', 'înregistrări actualizate')
      : undefined,
  ].filter((part) => part !== undefined);
  const rest =
    summary.unchanged > 0
      ? `; ${plural(summary.unchanged, 'înregistrare era', 'înregistrări erau')} deja la zi`
      : '';
  return `Date importate: ${changes.join(' și ')}${rest}.`;
}

export function ignoredSettingsText(count: number): string {
  return `${plural(count, 'setare din fișier a fost ignorată', 'setări din fișier au fost ignorate')}: rămân cele ale acestui dispozitiv.`;
}

export const SKIPPED_TEXT =
  'Unele înregistrări nu au putut fi incluse în fișier, fiindcă nu mai respectă formatul așteptat. Restul datelor sunt în fișier.';
