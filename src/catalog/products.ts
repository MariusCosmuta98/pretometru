import type { Product } from '@/domain';
import {
  createRecord,
  getActive,
  listActive,
  type PretometruDB,
  type StorageContext,
} from '@/storage';
import { rankProducts } from './product-search';
import type { NewProductInput } from './types';

const tidy = (text: string) => text.trim().replace(/\s+/g, ' ');

/**
 * Creates a product. The granularity is the user's call ("Smântână 30%" or one SKU), so nothing is
 * merged silently: two products with the same name are allowed. Throws a `RangeError` for an empty
 * name, an unknown category or a system category (Non-produs holds deposits, bags and fees).
 */
export async function createProduct(
  db: PretometruDB,
  input: NewProductInput,
  context?: StorageContext,
): Promise<Product> {
  const name = tidy(input.name);
  if (name === '') throw new RangeError('A product needs a name');
  const brand = input.brand === undefined ? '' : tidy(input.brand);

  return db.transaction('rw', [db.categories, db.products], async () => {
    const category = await getActive(db.categories, input.categoryId);
    if (!category) throw new RangeError(`Unknown category ${input.categoryId}`);
    if (category.system) throw new RangeError(`"${category.name}" is not a product category`);
    return createRecord(
      db.products,
      {
        name,
        ...(brand !== '' ? { brand } : {}),
        categoryId: input.categoryId,
        ...(input.ean !== undefined ? { ean: input.ean } : {}),
        baseUnit: input.baseUnit,
      },
      context,
    );
  });
}

/** Type-ahead search over live products by name, brand or EAN; see `rankProducts` for the order. */
export async function searchProducts(
  db: PretometruDB,
  query: string,
  limit = 20,
): Promise<Product[]> {
  return rankProducts(await listActive(db.products), query).slice(0, Math.max(0, limit));
}
