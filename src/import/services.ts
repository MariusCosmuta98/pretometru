import { newId } from '@/domain';
import { getDb, type PretometruDB } from '@/storage';
import { defaultAi, defaultCatalog, defaultEngines, defaultParser } from './engines';
import type { AiPort, CatalogPort, EnginePort, ParserPort } from './ports';

/** Everything the import pipeline and the screens depend on, injectable for tests. */
export interface ImportServices {
  getDb: () => Promise<PretometruDB>;
  parser: ParserPort;
  engines: EnginePort;
  catalog: CatalogPort;
  /** The optional Gemini reading, used only by the review's "Citește cu AI". */
  ai: AiPort;
  now: () => Date;
  newId: () => string;
}

const defaults: ImportServices = {
  getDb,
  parser: defaultParser,
  engines: defaultEngines,
  catalog: defaultCatalog,
  ai: defaultAi,
  now: () => new Date(),
  newId,
};

let current: ImportServices = defaults;

/** The services the screens use: the real ones unless `setImportServices` replaced some. */
export function getImportServices(): ImportServices {
  return current;
}

/** Replaces some services (tests, or a settings-driven engine). `resetImportServices` undoes it. */
export function setImportServices(overrides: Partial<ImportServices>): void {
  current = { ...defaults, ...overrides };
}

export function resetImportServices(): void {
  current = defaults;
}
