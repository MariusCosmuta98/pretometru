import type { Category } from './entities';

/**
 * Epoch, so that any user edit (a later `updatedAt`) wins over the seed on every device, and
 * independently seeded devices hold byte-identical records.
 */
export const SEED_UPDATED_AT = '1970-01-01T00:00:00.000Z';

// Well-known ULIDs (time part 0): persisted forever, because lines, products and aliases reference them.
const seedId = (n: number) => `0000000000SEEDCATEG${String(n).padStart(7, '0')}`;

function category(n: number, name: string, icon: string, color: string, system?: true): Category {
  return {
    id: seedId(n),
    updatedAt: SEED_UPDATED_AT,
    name,
    color,
    icon,
    order: system ? 1000 : n * 10,
    ...(system ? { system } : {}),
  };
}

export const NON_PRODUCT_CATEGORY_ID = seedId(16);

/** Plan §6 seed categories. Non-produs holds deposits, bags, discounts and fees. */
export const SEED_CATEGORIES: readonly Category[] = [
  category(1, 'Lactate & ouă', '🥛', '#3b82f6'),
  category(2, 'Carne & mezeluri', '🥩', '#ef4444'),
  category(3, 'Fructe & legume', '🥬', '#22c55e'),
  category(4, 'Panificație & cereale', '🍞', '#d97706'),
  category(5, 'Bacanie', '🥫', '#a16207'),
  category(6, 'Snacks & dulciuri', '🍫', '#ec4899'),
  category(7, 'Băuturi nealcoolice', '🥤', '#06b6d4'),
  category(8, 'Băuturi alcoolice', '🍷', '#9333ea'),
  category(9, 'Congelate', '🧊', '#0ea5e9'),
  category(10, 'Curățenie & menaj', '🧽', '#14b8a6'),
  category(11, 'Igienă & cosmetice', '🧴', '#8b5cf6'),
  category(12, 'Bebe & copii', '🍼', '#fb923c'),
  category(13, 'Casă & bricolaj', '🔧', '#64748b'),
  category(14, 'Animale', '🐾', '#84cc16'),
  category(15, 'Altele', '📦', '#78716c'),
  category(16, 'Non-produs', '➖', '#9ca3af', true),
];
