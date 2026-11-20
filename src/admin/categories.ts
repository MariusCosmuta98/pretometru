import { NON_PRODUCT_CATEGORY_ID, type Category } from '@/domain';
import {
  createRecord,
  getActive,
  listActive,
  softDelete,
  updateRecord,
  type PretometruDB,
  type RecordPatch,
  type StorageContext,
} from '@/storage';
import { AdminError } from './errors';
import { compareNames, nameKey, tidyName } from './text';

const isLive = (record: { deletedAt?: string | undefined }) => record.deletedAt === undefined;

/** Gap between the `order` of neighbouring categories: room to place one between two without renumbering. */
const ORDER_STEP = 10;

/** "Non-produs" holds deposits, bags, discounts and fees: it exists for the accounts to add up and is never edited. */
export function isSystemCategory(category: Pick<Category, 'id' | 'system'>): boolean {
  return category.system === true || category.id === NON_PRODUCT_CATEGORY_ID;
}

export interface CategoryInput {
  name: string;
  /** One emoji. */
  icon: string;
  /** `#rrggbb`. */
  color: string;
}

const COLOR = /^#[0-9a-f]{6}$/;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;

function graphemeCount(text: string): number {
  if (typeof Intl.Segmenter !== 'function') return [...text].length;
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length;
}

/** The icon without surrounding spaces; throws `INVALID_ICON` unless it is exactly one emoji. */
export function normalizeIcon(icon: string): string {
  const value = icon.trim();
  if (!EMOJI.test(value) || graphemeCount(value) !== 1) {
    throw new AdminError('INVALID_ICON', `"${value}" is not a single emoji`);
  }
  return value;
}

/** `#RRGGBB` as `#rrggbb`; throws `INVALID_COLOR` for anything else. */
export function normalizeColor(color: string): string {
  const value = color.trim().toLowerCase();
  if (!COLOR.test(value)) throw new AdminError('INVALID_COLOR', `"${color}" is not #rrggbb`);
  return value;
}

function checkName(name: string, live: readonly Category[], exceptId?: string): string {
  const tidy = tidyName(name);
  if (tidy === '') throw new AdminError('EMPTY_NAME', 'A category needs a name');
  const key = nameKey(tidy);
  if (live.some((category) => category.id !== exceptId && nameKey(category.name) === key)) {
    throw new AdminError('DUPLICATE_NAME', `There already is a category named "${tidy}"`);
  }
  return tidy;
}

/** The order the lists show: the user's order, then the system category last. */
function compareCategories(a: Category, b: Category): number {
  return (
    Number(isSystemCategory(a)) - Number(isSystemCategory(b)) ||
    a.order - b.order ||
    compareNames(a.name, b.name) ||
    a.id.localeCompare(b.id)
  );
}

export interface CategoryRow {
  category: Category;
  system: boolean;
  /** Live products in this category. */
  products: number;
  /** Live receipt lines in this category. */
  lines: number;
}

/** The live categories in display order (the system one last) with how much uses each. */
export function listCategories(db: PretometruDB): Promise<CategoryRow[]> {
  return db.transaction('r', [db.categories, db.products, db.lines], async () => {
    const categories = (await listActive(db.categories)).sort(compareCategories);
    return Promise.all(
      categories.map(async (category) => ({
        category,
        system: isSystemCategory(category),
        products: await db.products.where('categoryId').equals(category.id).filter(isLive).count(),
        lines: await db.lines.where('categoryId').equals(category.id).filter(isLive).count(),
      })),
    );
  });
}

/** Adds a category after the last one the user can order. Throws `AdminError` for a bad name, icon or colour. */
export function addCategory(
  db: PretometruDB,
  input: CategoryInput,
  context?: StorageContext,
): Promise<Category> {
  return db.transaction('rw', db.categories, async () => {
    const live = await listActive(db.categories);
    const name = checkName(input.name, live);
    const icon = normalizeIcon(input.icon);
    const color = normalizeColor(input.color);
    const last = live
      .filter((category) => !isSystemCategory(category))
      .reduce((max, category) => Math.max(max, category.order), 0);
    return createRecord(db.categories, { name, icon, color, order: last + ORDER_STEP }, context);
  });
}

/**
 * Changes a category's name, icon or colour (what `patch` leaves out stays). The write goes through
 * `updateRecord`, so the edit is newer than the built-in category it replaces, on every device. The
 * system category keeps its name. Writes nothing when nothing changes.
 */
export function updateCategory(
  db: PretometruDB,
  id: string,
  patch: Partial<CategoryInput>,
  context?: StorageContext,
): Promise<Category> {
  return db.transaction('rw', db.categories, async () => {
    const current = await getActive(db.categories, id);
    if (!current) throw new AdminError('NOT_FOUND', `Unknown category ${id}`);

    const changes: RecordPatch<Category> = {};
    if (patch.name !== undefined) {
      const name = tidyName(patch.name);
      if (isSystemCategory(current) && name !== current.name) {
        throw new AdminError('SYSTEM_CATEGORY', 'The system category cannot be renamed');
      }
      if (name !== current.name) {
        changes.name = checkName(name, await listActive(db.categories), id);
      }
    }
    if (patch.icon !== undefined && normalizeIcon(patch.icon) !== current.icon) {
      changes.icon = normalizeIcon(patch.icon);
    }
    if (patch.color !== undefined && normalizeColor(patch.color) !== current.color) {
      changes.color = normalizeColor(patch.color);
    }

    if (Object.keys(changes).length === 0) return current;
    return (await updateRecord(db.categories, id, changes, context)) ?? current;
  });
}

/**
 * Moves a category one place up or down among the ones the user can order and numbers them 10,
 * 20, 30... again, so that equal or gappy numbers left by two devices heal; only the categories
 * whose number changed are written. `false` when it already is first (or last).
 */
export function moveCategory(
  db: PretometruDB,
  id: string,
  direction: 'up' | 'down',
  context?: StorageContext,
): Promise<boolean> {
  return db.transaction('rw', db.categories, async () => {
    const live = await listActive(db.categories);
    const category = live.find((candidate) => candidate.id === id);
    if (!category) throw new AdminError('NOT_FOUND', `Unknown category ${id}`);
    if (isSystemCategory(category)) {
      throw new AdminError('SYSTEM_CATEGORY', 'The system category stays last');
    }

    const orderable = live
      .filter((candidate) => !isSystemCategory(candidate))
      .sort(compareCategories);
    const from = orderable.findIndex((candidate) => candidate.id === id);
    const to = direction === 'up' ? from - 1 : from + 1;
    const neighbour = orderable[to];
    if (neighbour === undefined) return false;
    orderable[to] = category;
    orderable[from] = neighbour;

    for (const [position, candidate] of orderable.entries()) {
      const order = (position + 1) * ORDER_STEP;
      if (candidate.order !== order)
        await updateRecord(db.categories, candidate.id, { order }, context);
    }
    return true;
  });
}

export interface DeletedCategory {
  category: Category;
  /** Where the products and lines went; absent when nothing used the category. */
  reassignedTo: Category | undefined;
  products: number;
  lines: number;
  /** Sub-categories that now hang from the deleted category's own parent. */
  children: number;
}

/**
 * Deletes a category (a tombstone, so the deletion syncs and the built-in one is not brought back).
 * Its live products and lines move to `reassignTo`, which is mandatory while any uses it, so that
 * no product is left without a category; sub-categories move up to its parent. All or nothing.
 * Throws `AdminError`: the system category cannot be deleted, `TARGET_REQUIRED` without a target,
 * `INVALID_TARGET` for a target that is missing, deleted, the system category or the category itself.
 */
export function deleteCategory(
  db: PretometruDB,
  id: string,
  options: { reassignTo?: string } = {},
  context?: StorageContext,
): Promise<DeletedCategory> {
  return db.transaction('rw', [db.categories, db.products, db.lines], async () => {
    const category = await getActive(db.categories, id);
    if (!category) throw new AdminError('NOT_FOUND', `Unknown category ${id}`);
    if (isSystemCategory(category)) {
      throw new AdminError('SYSTEM_CATEGORY', 'The system category cannot be deleted');
    }

    const products = await db.products.where('categoryId').equals(id).filter(isLive).toArray();
    const lines = await db.lines.where('categoryId').equals(id).filter(isLive).toArray();

    let target: Category | undefined;
    if (options.reassignTo !== undefined) {
      target = await getActive(db.categories, options.reassignTo);
      if (!target || target.id === id || isSystemCategory(target)) {
        throw new AdminError('INVALID_TARGET', `Cannot move to ${options.reassignTo}`);
      }
    } else if (products.length + lines.length > 0) {
      throw new AdminError(
        'TARGET_REQUIRED',
        `${products.length} product(s) and ${lines.length} line(s) use this category`,
      );
    }

    if (target) {
      for (const product of products) {
        await updateRecord(db.products, product.id, { categoryId: target.id }, context);
      }
      for (const line of lines) {
        await updateRecord(db.lines, line.id, { categoryId: target.id }, context);
      }
    }

    const children = await db.categories.where('parentId').equals(id).filter(isLive).toArray();
    for (const child of children) {
      await updateRecord(db.categories, child.id, { parentId: category.parentId }, context);
    }

    await softDelete(db.categories, id, context);
    return {
      category,
      reassignedTo: target,
      products: products.length,
      lines: lines.length,
      children: children.length,
    };
  });
}
