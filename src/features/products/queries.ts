import { getProductSummary, listProductSummaries, type ProductPriceSummary } from '@/analytics';
import type { Category } from '@/domain';
import { getSetting, listActive, type PretometruDB } from '@/storage';

export interface OverviewGroup {
  /** Absent for products whose category was deleted: shown last as "Fără categorie". */
  category?: Category;
  products: ProductPriceSummary[];
}

export interface ProductsOverview {
  groups: OverviewGroup[];
  windowDays: number;
  excludeSales: boolean;
}

const byName = (a: ProductPriceSummary, b: ProductPriceSummary) =>
  a.product.name.localeCompare(b.product.name, 'ro');

/** Every product with its price summary, grouped by category (seed order). */
export async function loadOverview(db: PretometruDB): Promise<ProductsOverview> {
  const summaries = await listProductSummaries(db);
  const categories = (await listActive(db.categories))
    .filter((category) => !category.system)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ro'));

  const known = new Set(categories.map((category) => category.id));
  const groups: OverviewGroup[] = categories.map((category) => ({
    category,
    products: summaries.filter((s) => s.product.categoryId === category.id).sort(byName),
  }));
  const orphans = summaries.filter((s) => !known.has(s.product.categoryId)).sort(byName);
  if (orphans.length > 0) groups.push({ products: orphans });

  return {
    groups: groups.filter((group) => group.products.length > 0),
    windowDays: await getSetting(db, 'priceWindowDays'),
    excludeSales: await getSetting(db, 'excludeDiscountedPrices'),
  };
}

export interface ProductPage {
  summary: ProductPriceSummary;
  category?: Category;
  /** Live, non-system categories: the choices for a product split off from this one. */
  categories: Category[];
  windowDays: number;
  excludeSales: boolean;
}

/** `undefined` when the product does not exist (any more). */
export async function loadProductPage(
  db: PretometruDB,
  productId: string,
): Promise<ProductPage | undefined> {
  const summary = await getProductSummary(db, productId);
  if (!summary) return undefined;
  const categories = (await listActive(db.categories))
    .filter((category) => !category.system)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ro'));
  const category = categories.find((candidate) => candidate.id === summary.product.categoryId);
  return {
    summary,
    ...(category ? { category } : {}),
    categories,
    windowDays: summary.windowDays,
    excludeSales: await getSetting(db, 'excludeDiscountedPrices'),
  };
}
