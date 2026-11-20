import { describe, expect, it } from 'vitest';
import { SEED_CATEGORIES } from '@/domain';
import { getFixture } from '@fixtures';
import { categoryForHint } from './category-hints';

const nameOf = (hint: string) =>
  SEED_CATEGORIES.find((category) => category.id === categoryForHint(hint))?.name;

describe('categoryForHint', () => {
  // Every section header of the real (sanitized) Kaufland receipt, and where it should land.
  const KAUFLAND_2026_11_07: Record<string, string | undefined> = {
    Alimente: 'Bacanie',
    'Băuturi alcoolice': 'Băuturi alcoolice',
    'Carne/ Autoservire carne': 'Carne & mezeluri',
    'Casa mea': 'Casă & bricolaj',
    'Delicatese/Convenience/Marinade': undefined, // too broad to guess
    'Drogerie/Gospodărie/Hrană animale/Tabac': 'Curățenie & menaj', // the first department decides
    'Fructe / Legume / Plante': 'Fructe & legume',
    'Frumuseţe, Sănătate, Copii': 'Igienă & cosmetice',
    'Mopro/Brânză/Ouă': 'Lactate & ouă',
    'Nonfood - Altele': 'Altele',
  };

  it('maps every header of the real Kaufland receipt', () => {
    const printed = new Set(
      getFixture('kaufland-2026-11-07').expected.lines.map((line) => line.storeCategoryHint),
    );
    expect([...printed].sort()).toEqual(Object.keys(KAUFLAND_2026_11_07).sort());
    for (const [header, category] of Object.entries(KAUFLAND_2026_11_07)) {
      expect(nameOf(header), header).toBe(category);
    }
  });

  it('lets a specific word beat a generic qualifier', () => {
    expect(nameOf('Alimente congelate')).toBe('Congelate');
    expect(nameOf('Băuturi nealcoolice')).toBe('Băuturi nealcoolice');
    expect(nameOf('Nonfood - Textile')).toBe('Altele'); // only the generic "nonfood" applies
  });

  it('reads the department named first when a header lists several', () => {
    expect(nameOf('Animale / Drogerie')).toBe('Animale');
    expect(nameOf('Drogerie / Animale')).toBe('Curățenie & menaj');
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
