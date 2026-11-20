import type { BaseUnit, PackUnit, Product } from '@/domain';

/** Content of ONE sold unit, with the number of consumer units in it when known (`6X2L`). */
export interface PackChoice {
  qty: number;
  unit: PackUnit;
  unitsPerPack?: number;
}

/**
 * The first step of alias -> EAN -> fuzzy -> category hint that produced something for a line.
 * Only `alias` and `ean` assign a product; the others leave the decision to a human.
 */
export type MatchVia = 'alias' | 'ean' | 'fuzzy' | 'category-hint' | 'none';

export interface MappingCandidate {
  product: Product;
  /** 0..1, higher is a better match (1 = certain); candidates come best first. */
  score: number;
}

/**
 * What the catalog knows about one printed receipt line (see `suggestMappings`).
 *
 * - `alias` / `ean`: `productId` is set (the matched product is also `candidates[0]` with score 1)
 *   together with the product's `categoryId` (when that category still exists).
 * - `fuzzy`: no product is assigned; `candidates` holds likely products for a human to confirm.
 *   `categoryId` is still filled from the receipt's section header when it maps to a category.
 * - `category-hint`: no product and no candidates, but the section header gave a `categoryId`.
 * - `none`: nothing is known (non-product lines get the Non-produs category and `none`).
 *
 * `pack` is only set when an alias knows the size of the product and the printed name does not.
 */
export interface LineMapping {
  productId?: string;
  categoryId?: string;
  pack?: PackChoice;
  via: MatchVia;
  candidates: MappingCandidate[];
}

export interface NewProductInput {
  name: string;
  brand?: string;
  categoryId: string;
  ean?: string;
  baseUnit: BaseUnit;
}

/** A confirmed line mapping that `rememberMappings` turns into an alias. */
export interface MappingChoice {
  rawName: string;
  ean?: string;
  productId: string;
  pack?: PackChoice;
}
