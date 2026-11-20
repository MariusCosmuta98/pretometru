import { normalizeName, type Alias, type Line, type Product } from '@/domain';
import {
  createRecord,
  getActive,
  softDelete,
  updateRecord,
  type PretometruDB,
  type StorageContext,
} from '@/storage';
import { normalizeEan } from './ean';
import { chainsByReceipt, linesOfProduct } from './lines';
import { createProduct } from './products';
import type { NewProductInput } from './types';

const isLive = (record: { deletedAt?: string | undefined }) => record.deletedAt === undefined;

export interface MergeResult {
  /** The surviving product. */
  product: Product;
  lines: number;
  aliases: number;
  listItems: number;
}

/**
 * Folds duplicate products into one: their lines, aliases and shopping-list items now point at
 * `intoId`, and the duplicates are deleted (tombstones). A duplicate's EAN is kept as an EAN-only
 * alias, so the code still finds the surviving product. The target keeps its own name, category
 * and base unit. Throws a `RangeError` (and changes nothing) for an unknown or deleted product.
 */
export async function mergeProducts(
  db: PretometruDB,
  intoId: string,
  fromIds: readonly string[],
  context?: StorageContext,
): Promise<MergeResult> {
  const sources = [...new Set(fromIds)].filter((id) => id !== intoId);
  return db.transaction(
    'rw',
    [db.products, db.aliases, db.lines, db.listItems],
    async (): Promise<MergeResult> => {
      const product = await getActive(db.products, intoId);
      if (!product) throw new RangeError(`Unknown product ${intoId}`);
      const result: MergeResult = { product, lines: 0, aliases: 0, listItems: 0 };

      for (const fromId of sources) {
        const from = await getActive(db.products, fromId);
        if (!from) throw new RangeError(`Unknown product ${fromId}`);

        for (const line of await linesOfProduct(db, fromId)) {
          await updateRecord(
            db.lines,
            line.id,
            { productId: intoId, categoryId: product.categoryId },
            context,
          );
          result.lines += 1;
        }

        const aliases = await db.aliases.where('productId').equals(fromId).filter(isLive).toArray();
        for (const alias of aliases) {
          await updateRecord(db.aliases, alias.id, { productId: intoId }, context);
          result.aliases += 1;
        }

        if (from.ean !== undefined && from.ean !== product.ean) {
          const carried = await db.aliases
            .where('ean')
            .equals(from.ean)
            .filter((alias) => isLive(alias) && alias.productId === intoId)
            .count();
          // `ean:…` can never equal a normalised printed name, so this alias matches the code only.
          if (carried === 0) {
            await createRecord(
              db.aliases,
              { normName: `ean:${from.ean}`, ean: from.ean, productId: intoId },
              context,
            );
          }
        }

        const items = await db.listItems.where('productId').equals(fromId).filter(isLive).toArray();
        for (const item of items) {
          await updateRecord(db.listItems, item.id, { productId: intoId }, context);
          result.listItems += 1;
        }

        await softDelete(db.products, fromId, context);
      }
      return result;
    },
  );
}

export interface SplitInput {
  /** The lines to move; each must currently belong to the source product. */
  lineIds: readonly string[];
  /** An existing product, or a new one to create from the user's input. */
  target: { productId: string } | { create: NewProductInput };
}

export interface SplitResult {
  /** The product that received the lines. */
  product: Product;
  lines: number;
  aliases: number;
}

/** Does this alias say anything about the line (same printed name at its chain, or same EAN)? */
function aliasCovers(alias: Alias, line: Line, chain: string | undefined): boolean {
  const sameName =
    normalizeName(line.rawName) === alias.normName &&
    (alias.chain === undefined || alias.chain === chain);
  const sameEan =
    alias.ean !== undefined &&
    line.ean !== undefined &&
    normalizeEan(alias.ean) === normalizeEan(line.ean);
  return sameName || sameEan;
}

/**
 * Moves chosen purchases (lines) of a product to another, existing or new, product: the way to
 * undo a too coarse product ("Smântână 30%" that really is two brands). An alias follows its lines
 * only when every line it covers moves, so the next import of that printed name goes to the new
 * product; an alias that still has lines left behind keeps pointing at the source. Throws a
 * `RangeError` (and changes nothing) for an empty selection, a line of another product, an unknown
 * product, or a target that is the source itself.
 */
export async function splitProduct(
  db: PretometruDB,
  sourceId: string,
  { lineIds, target }: SplitInput,
  context?: StorageContext,
): Promise<SplitResult> {
  const moving = [...new Set(lineIds)];
  if (moving.length === 0) throw new RangeError('Select at least one line to split off');

  return db.transaction(
    'rw',
    [db.products, db.categories, db.aliases, db.lines, db.receipts, db.stores],
    async (): Promise<SplitResult> => {
      if (!(await getActive(db.products, sourceId))) {
        throw new RangeError(`Unknown product ${sourceId}`);
      }
      const lines = await linesOfProduct(db, sourceId);
      const known = new Set(lines.map((line) => line.id));
      const stray = moving.find((id) => !known.has(id));
      if (stray !== undefined) throw new RangeError(`Line ${stray} does not belong to ${sourceId}`);

      const product =
        'productId' in target
          ? await getActive(db.products, target.productId)
          : await createProduct(db, target.create, context);
      if (!product) throw new RangeError('Unknown target product');
      if (product.id === sourceId) throw new RangeError('A product cannot be split into itself');

      const chains = await chainsByReceipt(
        db,
        lines.map((line) => line.receiptId),
      );
      const movingSet = new Set(moving);
      const aliases = await db.aliases.where('productId').equals(sourceId).filter(isLive).toArray();
      let followed = 0;
      for (const alias of aliases) {
        const covered = lines.filter((line) =>
          aliasCovers(alias, line, chains.get(line.receiptId)),
        );
        if (covered.length > 0 && covered.every((line) => movingSet.has(line.id))) {
          await updateRecord(db.aliases, alias.id, { productId: product.id }, context);
          followed += 1;
        }
      }

      for (const id of moving) {
        await updateRecord(
          db.lines,
          id,
          { productId: product.id, categoryId: product.categoryId },
          context,
        );
      }
      return { product, lines: moving.length, aliases: followed };
    },
  );
}
