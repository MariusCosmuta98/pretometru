import { describe, expect, it } from 'vitest';
import { baseUnitOf, PackUnitSchema, parsePackSize, toMilliBase } from './units';

describe('parsePackSize', () => {
  it.each([
    ['LAPTE UHT 3.5% 1L', { qty: 1, unit: 'l' }],
    ['APA PLATA 0,5L', { qty: 0.5, unit: 'l' }],
    ['APA PLATA 0.5 L', { qty: 0.5, unit: 'l' }],
    ['lapte 1l', { qty: 1, unit: 'l' }],
    ['LAPTE 1LT', { qty: 1, unit: 'l' }],
    ['SUC 425ML', { qty: 425, unit: 'ml' }],
    ['BERE 33CL', { qty: 330, unit: 'ml' }],
    ['FAINA ALBA 1KG', { qty: 1, unit: 'kg' }],
    ['UNT 82% 200G', { qty: 200, unit: 'g' }],
    ['CAFEA 250GR', { qty: 250, unit: 'g' }],
    ['HARTIE IGIENICA 8ROLE', { qty: 8, unit: 'role' }],
    ['HARTIE IGIENICA 8 ROLE', { qty: 8, unit: 'role' }],
    ['SERVETELE UMEDE 120BUC', { qty: 120, unit: 'buc' }],
    ['OUA M 10BUC', { qty: 10, unit: 'buc' }],
    ['FOLIE ALUMINIU 100M', { qty: 100, unit: 'm' }],
    ['SAMPON 400ML GRATIS 100ML', { qty: 400, unit: 'ml' }],
  ])('reads the size of %j', (name, expected) => {
    expect(parsePackSize(name)).toEqual(expected);
  });

  it.each([
    ['DROJDIE 8G*4', { qty: 32, unit: 'g', unitsPerPack: 4 }],
    ['IAURT 4X125G', { qty: 500, unit: 'g', unitsPerPack: 4 }],
    ['GEL DUS 2X250ML', { qty: 500, unit: 'ml', unitsPerPack: 2 }],
    ['APA 6X2L', { qty: 12, unit: 'l', unitsPerPack: 6 }],
    ['COLA 6 x 0,5L', { qty: 3, unit: 'l', unitsPerPack: 6 }],
    ['APA 3X0,33L', { qty: 0.99, unit: 'l', unitsPerPack: 3 }],
    ['BERE 6X330ML', { qty: 1980, unit: 'ml', unitsPerPack: 6 }],
  ])('multiplies multipacks: %j is the content of one sold unit', (name, expected) => {
    expect(parsePackSize(name)).toEqual(expected);
  });

  it.each([
    ['DROJDIE 8G * 4', { qty: 8, unit: 'g', ambiguous: true }],
    ['COLA 2L X6', { qty: 2, unit: 'l', ambiguous: true }],
    ['SUC 330ML X 24', { qty: 330, unit: 'ml', ambiguous: true }],
    ['HARTIE 8 ROLE X 3 STRATURI', { qty: 8, unit: 'role', ambiguous: true }],
  ])(
    'flags a spaced multiplier as ambiguous instead of silently dropping it: %j',
    (name, expected) => {
      expect(parsePackSize(name)).toEqual(expected);
    },
  );

  it('skips weight ranges and takes the real pack size', () => {
    expect(parsePackSize('PAMPERS PREMIUM 9-14KG 46BUC')).toEqual({ qty: 46, unit: 'buc' });
    expect(parsePackSize('SCAUN AUTO 9-18KG')).toBeUndefined();
  });

  it('reads meters only when glued to the number (a clothing size is not a length)', () => {
    expect(parsePackSize('FOLIE ALUMINIU 100M')).toEqual({ qty: 100, unit: 'm' });
    expect(parsePackSize('TRICOU 38 M')).toBeUndefined();
  });

  it('refuses sizes beyond what a receipt quantity can hold', () => {
    expect(parsePackSize('PROMO 9999999X1000KG')).toBeUndefined();
  });

  it.each([
    ['empty', ''],
    ['percentage only', 'SMANTANA 30%'],
    ['unit without a number', 'ROSII KG'],
    ['stray METRO unit token', 'CAPSUNI BUC'],
    ['number glued to letters (product code)', 'ARTICOL A123G'],
    ['unit followed by letters', 'TEST 5MLX'],
    ['unsupported unit (mg)', 'VITAMINA C 1000MG'],
    ['zero size', 'GOL 0G'],
  ])('finds no size in %s', (_label, name) => {
    expect(parsePackSize(name)).toBeUndefined();
  });
});

describe('units', () => {
  it('maps pack units to the base unit prices are compared in', () => {
    expect(baseUnitOf('g')).toBe('kg');
    expect(baseUnitOf('ml')).toBe('l');
    expect(baseUnitOf('role')).toBe('role');
  });

  it.each([
    [400, 'g', 400],
    [1, 'kg', 1000],
    [0.92, 'kg', 920],
    [425, 'ml', 425],
    [1.5, 'l', 1500],
    [8, 'role', 8000],
    [120, 'buc', 120_000],
    [100, 'm', 100_000],
  ] as const)('counts %d %s as %d milli-base units', (qty, unit, expected) => {
    expect(toMilliBase(qty, unit)).toBe(expected);
  });

  it('knows exactly the pack units the contract lists', () => {
    expect(PackUnitSchema.safeParse('role').success).toBe(true);
    expect(PackUnitSchema.safeParse('mg').success).toBe(false);
  });
});
