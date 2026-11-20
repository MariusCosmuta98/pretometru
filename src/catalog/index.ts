// Public surface of the catalog (product matching, aliases, categories). Import from '@/catalog'.
// React-free: it may use the domain and storage layers only.
export { rememberMappings, setAliasDefaultPack } from './aliases';
export { categoryForHint } from './category-hints';
export { suggestMappings } from './matching';
export { mergeProducts, splitProduct } from './merge';
export type { MergeResult, SplitInput, SplitResult } from './merge';
export { createProduct, searchProducts } from './products';
export type {
  LineMapping,
  MappingCandidate,
  MappingChoice,
  MatchVia,
  NewProductInput,
  PackChoice,
} from './types';
