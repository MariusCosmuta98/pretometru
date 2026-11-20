import type { LoaderFunctionArgs } from 'react-router';
import { todayKey, type Category, type Product, type Receipt } from '@/domain';
import {
  analyze,
  applySuggestions,
  blankDraft,
  dropUnknownProducts,
  findDraftDuplicates,
  formFromDraft,
  getImportServices,
  getReviewSession,
  loadDraft,
  parsedFromDraft,
  readForm,
  type Acks,
  type LineMapping,
  type ReceiptForm,
} from '@/import';
import { listActive } from '@/storage';

export interface ReviewReady {
  status: 'ready';
  /** `bonuri/nou`: a receipt typed in by hand; nothing is stored until the first save. */
  isNew: boolean;
  form: ReceiptForm;
  /** Warnings already accepted when the receipt was confirmed, so editing it does not ask again. */
  initialAcks: Acks;
  duplicates: Receipt[];
  /** What the catalog proposed per line id. */
  suggestions: Record<string, LineMapping>;
  /** The products the lines and the suggestions refer to. */
  products: Product[];
  categories: Category[];
  /** The photo, still in memory when the receipt was imported in this session. */
  original?: Blob;
  /** The clock of the review (ms), fixed when it opens. */
  now: number;
}

export type ReviewData =
  ReviewReady | { status: 'not-found' } | { status: 'error'; detail: string };

/** Route loader of `bonuri/:receiptId` and `bonuri/nou`. */
export async function loader({ params }: LoaderFunctionArgs): Promise<ReviewData> {
  const services = getImportServices();
  try {
    const db = await services.getDb();
    const now = services.now();
    const receiptId = params['receiptId'];
    const isNew = receiptId === undefined;

    const draft = isNew
      ? blankDraft({ date: todayKey(now) })
      : await loadDraft(services, receiptId);
    if (!draft) return { status: 'not-found' };

    // The catalog is an aid: without it the lines are simply unmapped.
    let mappings: LineMapping[] = [];
    if (draft.lines.length > 0) {
      try {
        mappings = await services.catalog.suggestMappings(db, parsedFromDraft(draft));
      } catch {
        mappings = [];
      }
    }

    const referenced = [...new Set(draft.lines.flatMap((line) => line.productId ?? []))];
    const stored = (await db.products.bulkGet(referenced)).filter(
      (product): product is Product => product !== undefined && product.deletedAt === undefined,
    );
    let form = dropUnknownProducts(formFromDraft(draft), new Set(stored.map((p) => p.id)));
    // A confirmed receipt keeps what it has; only a draft takes the catalog's word for it.
    if (draft.status === 'draft') form = applySuggestions(form, mappings);

    const suggestions: Record<string, LineMapping> = {};
    form.lines.forEach((line, index) => {
      const mapping = mappings[index];
      if (mapping) suggestions[line.id] = mapping;
    });
    const products = new Map(stored.map((product) => [product.id, product]));
    for (const mapping of mappings) {
      for (const { product } of mapping.candidates) products.set(product.id, product);
    }

    const categories = (await listActive(db.categories)).sort((a, b) => a.order - b.order);
    const duplicates = await findDraftDuplicates(db, draft);
    const initialAcks: Acks =
      draft.status === 'confirmed'
        ? analyze(readForm(form).draft, {
            parser: services.parser,
            now,
            duplicates,
            reviewed: new Set(),
          }).ackTokens
        : {};

    const original = receiptId === undefined ? undefined : getReviewSession(receiptId)?.original;
    return {
      status: 'ready',
      isNew,
      form,
      initialAcks,
      duplicates,
      suggestions,
      products: [...products.values()],
      categories,
      ...(original ? { original } : {}),
      now: now.getTime(),
    };
  } catch (error) {
    return { status: 'error', detail: error instanceof Error ? error.message : String(error) };
  }
}
