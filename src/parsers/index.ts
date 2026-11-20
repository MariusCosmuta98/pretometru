// Public surface of the parsers layer (pure: no DOM, storage or network). Import from '@/parsers'.
// Parser folders (`src/parsers/<id>/`) must NOT import this barrel: it pulls in the registry, which
// imports every parser. They import the specific modules (`../validate`, `../source`, ...).
export { parseReceipt, parseReceiptWith, type ParseReceiptOptions } from './parse-receipt';
export { parsers, rankParsers, validateParsers, type RankedParser } from './registry';
export { engineForSource } from './source';
export * from './validate';
