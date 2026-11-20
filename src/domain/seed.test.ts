import { describe, expect, it } from 'vitest';
import { CategorySchema } from './entities';
import { NON_PRODUCT_CATEGORY_ID, SEED_CATEGORIES, SEED_UPDATED_AT } from './seed';

describe('SEED_CATEGORIES', () => {
  it('are the categories of plan §6, with Non-produs as the only system category', () => {
    expect(SEED_CATEGORIES.map((category) => category.name)).toEqual([
      'Lactate & ouă',
      'Carne & mezeluri',
      'Fructe & legume',
      'Panificație & cereale',
      'Bacanie',
      'Snacks & dulciuri',
      'Băuturi nealcoolice',
      'Băuturi alcoolice',
      'Congelate',
      'Curățenie & menaj',
      'Igienă & cosmetice',
      'Bebe & copii',
      'Casă & bricolaj',
      'Animale',
      'Altele',
      'Non-produs',
    ]);
    expect(SEED_CATEGORIES.filter((c) => c.system).map((c) => c.id)).toEqual([
      NON_PRODUCT_CATEGORY_ID,
    ]);
  });

  it('are valid, uniquely identified and ordered', () => {
    for (const category of SEED_CATEGORIES) {
      expect(CategorySchema.safeParse(category).success, category.name).toBe(true);
    }
    expect(new Set(SEED_CATEGORIES.map((c) => c.id)).size).toBe(SEED_CATEGORIES.length);
    const orders = SEED_CATEGORIES.map((c) => c.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it('use the epoch as updatedAt so any user edit wins over the seed on every device', () => {
    expect(SEED_UPDATED_AT).toBe('1970-01-01T00:00:00.000Z');
    expect(SEED_CATEGORIES.every((c) => c.updatedAt === SEED_UPDATED_AT)).toBe(true);
  });

  it('keep their ids forever: lines, products and aliases reference them', () => {
    expect(SEED_CATEGORIES[0]?.id).toBe('0000000000SEEDCATEG0000001');
    expect(NON_PRODUCT_CATEGORY_ID).toBe('0000000000SEEDCATEG0000016');
  });
});
