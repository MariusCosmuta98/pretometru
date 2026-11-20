import { isAdminError, type AdminErrorCode, type DeletedCategory } from '@/admin';
import { plural } from '@/ui/plural';

export type Field = 'name' | 'icon' | 'color';

const FIELDS: Partial<Record<AdminErrorCode, Field>> = {
  EMPTY_NAME: 'name',
  DUPLICATE_NAME: 'name',
  INVALID_ICON: 'icon',
  INVALID_COLOR: 'color',
};

const TEXT: Partial<Record<AdminErrorCode, string>> = {
  EMPTY_NAME: 'Scrie un nume pentru categorie.',
  DUPLICATE_NAME: 'Există deja o categorie cu acest nume.',
  INVALID_ICON: 'Alege un singur emoji, de exemplu 🥛.',
  INVALID_COLOR: 'Alege o culoare.',
  NOT_FOUND: 'Categoria nu mai există: poate a fost ștearsă pe alt dispozitiv.',
  SYSTEM_CATEGORY: 'Categoria „Non-produs” nu poate fi redenumită, mutată sau ștearsă.',
  TARGET_REQUIRED: 'Alege categoria în care se mută produsele.',
  INVALID_TARGET: 'Categoria aleasă nu mai există sau nu poate primi produse. Alege alta.',
};

/** The field an error is about, so that focus can go there. */
export function fieldOf(error: unknown): Field | undefined {
  return isAdminError(error) ? FIELDS[error.code] : undefined;
}

/** What went wrong, in words; an unexpected failure (the database) gets a general sentence. */
export function errorText(error: unknown): string {
  return (
    (isAdminError(error) ? TEXT[error.code] : undefined) ??
    'Nu am putut face schimbarea. Nu s-a modificat nimic; încearcă din nou.'
  );
}

/** What a category is used for: `14 produse și 52 de linii de bon`, and whether that is a single thing (for the verb). */
function usage(products: number, lines: number): { parts: string; single: boolean } {
  const parts = [
    products > 0 ? plural(products, 'produs', 'produse') : undefined,
    lines > 0 ? plural(lines, 'linie de bon', 'linii de bon') : undefined,
  ].filter((part) => part !== undefined);
  return { parts: parts.join(' și '), single: products + lines === 1 };
}

/** `14 produse și 52 de linii de bon folosesc această categorie.` */
export function usageText(products: number, lines: number): string {
  const { parts, single } = usage(products, lines);
  return `${parts} ${single ? 'folosește' : 'folosesc'} această categorie.`;
}

/** What a deletion did, for the status line. */
export function deletedText(result: DeletedCategory): string {
  const name = `Categoria „${result.category.name}” a fost ștearsă`;
  if (!result.reassignedTo || result.products + result.lines === 0) return `${name}.`;
  const { parts, single } = usage(result.products, result.lines);
  return `${name}; ${parts} ${single ? 'a trecut' : 'au trecut'} la „${result.reassignedTo.name}”.`;
}

/** Suggestions for the emoji field: groceries first, then the rest of the household. */
// prettier-ignore
export const ICON_CHOICES = [
  '🍎', '🥕', '🥦', '🍞', '🥐', '🧀', '🥛', '🥚', '🥩', '🐟',
  '🍝', '🥫', '🍫', '🍪', '🍿', '☕', '🥤', '🍷', '🍺', '🧊',
  '🧽', '🧻', '🧴', '💊', '🍼', '🐾', '🔧', '🏠', '🎁', '📦',
] as const;

/** The colours of the built-in categories: easy to tell apart on a chart. */
// prettier-ignore
export const COLOR_CHOICES = [
  '#3b82f6', '#ef4444', '#22c55e', '#d97706', '#a16207',
  '#ec4899', '#06b6d4', '#9333ea', '#0ea5e9', '#14b8a6',
  '#8b5cf6', '#fb923c', '#64748b', '#84cc16', '#78716c',
] as const;
