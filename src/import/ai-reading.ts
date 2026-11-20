import type { ParsedReceipt, Product } from '@/domain';
import { defined } from './defined';
import { draftFromParsed } from './draft';
import { applySuggestions, formFromDraft, type ReceiptForm } from './form';
import type { LineMapping } from './ports';
import type { ImportServices } from './services';

/** A fresh reading of a receipt, ready to be shown in the review. */
export interface AdoptedReading {
  /** The receipt the review edits, with the new lines and totals and the catalog's suggestions applied. */
  form: ReceiptForm;
  /** What the catalog proposed per line id of `form`. */
  suggestions: Record<string, LineMapping>;
  /** The products the lines and the suggestions refer to. */
  products: Product[];
}

/**
 * Puts another reading of the same photo (the optional Gemini one) in the place of the receipt's
 * lines and totals. The receipt stays the same receipt (id, store record, status, source), and the
 * reading is checked and mapped like any other: its warnings come from `parsed.meta`, the catalog
 * proposes products for its lines.
 *
 * Amounts, lines and `extraction` come from the new reading alone, so its arithmetic stands or
 * falls by itself. The header takes the new reading's value when it read one and otherwise keeps
 * what the receipt had: a chain the user chose in the review survives a reading that could not tell
 * the store, and a date the first reading found survives one that missed it. Nothing is saved:
 * the caller shows the result and the user saves it, like any edit.
 */
export async function adoptReading(
  services: ImportServices,
  current: ReceiptForm,
  parsed: ParsedReceipt,
): Promise<AdoptedReading> {
  const draft = draftFromParsed(
    parsed,
    defined({
      kind: current.source.kind,
      fileHash: current.source.fileHash,
      fileName: current.source.fileName,
    }),
    services.newId,
  );
  const read = formFromDraft(draft);

  const keepStore = parsed.chain === 'unknown' && current.chain !== 'unknown';
  const readDate = read.date !== '';
  const merged: ReceiptForm = defined({
    ...read,
    id: current.id,
    storeId: current.storeId,
    status: current.status,
    source: current.source,
    chain: keepStore ? current.chain : read.chain,
    storeName: keepStore ? current.storeName : read.storeName,
    branchCode: read.branchCode || current.branchCode,
    city: read.city || current.city,
    documentNo: read.documentNo || current.documentNo,
    date: readDate ? read.date : current.date,
    time: readDate ? read.time : current.time,
  });

  // The catalog is an aid: without it the lines are simply unmapped.
  let mappings: LineMapping[] = [];
  try {
    mappings = await services.catalog.suggestMappings(await services.getDb(), {
      ...parsed,
      chain: merged.chain,
    });
  } catch {
    mappings = [];
  }

  const form = applySuggestions(merged, mappings);
  const suggestions: Record<string, LineMapping> = {};
  form.lines.forEach((line, index) => {
    const mapping = mappings[index];
    if (mapping) suggestions[line.id] = mapping;
  });
  const products = new Map<string, Product>();
  for (const mapping of mappings) {
    for (const { product } of mapping.candidates) products.set(product.id, product);
  }
  return { form, suggestions, products: [...products.values()] };
}
