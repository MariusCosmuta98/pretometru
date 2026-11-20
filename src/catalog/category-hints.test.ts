import { describe, expect, it } from 'vitest';
import { SEED_CATEGORIES } from '@/domain';
import { categoryForHint } from './category-hints';

const nameOf = (hint: string) =>
  SEED_CATEGORIES.find((category) => category.id === categoryForHint(hint))?.name;

describe('categoryForHint', () => {
  it.each([
    ['Mopro/Brânză/Ouă', 'Lactate & ouă'],
    ['Alimente', 'Bacanie'],
    ['Băuturi alcoolice', 'Băuturi alcoolice'],
    ['Băuturi nealcoolice', 'Băuturi nealcoolice'],
    ['LEGUME/FRUCTE', 'Fructe & legume'],
    ['Produse congelate', 'Congelate'],
    ['Alimente congelate', 'Congelate'],
    ['Non-food', 'Casă & bricolaj'],
    ['Panificație', 'Panificație & cereale'],
  ])('maps "%s" to %s', (hint, category) => {
    expect(nameOf(hint)).toBe(category);
  });

  it('leaves unknown or empty headers open instead of guessing', () => {
    expect(categoryForHint('Raionul 7')).toBeUndefined();
    expect(categoryForHint('   ')).toBeUndefined();
  });

  it('matches whole words, not fragments of longer ones', () => {
    expect(categoryForHint('Vinete')).toBeUndefined(); // not "vin"
    expect(categoryForHint('Competiție')).toBeUndefined(); // not "pet"
  });
});
