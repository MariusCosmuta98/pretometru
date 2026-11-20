/**
 * Typed access to the fixtures under `tests/fixtures/{real,synthetic}/<case>/`. Test code only:
 * never import this from production code (it would pull every fixture into the bundle).
 *
 *   import { fixtures, getFixture, sourceOf, normalizeForGolden } from '@fixtures';
 *
 * Layout and conventions: docs/architecture.md §7 and tests/fixtures/README.md. Every file is
 * validated against the domain schemas when this module loads, so a broken fixture fails loudly
 * with its path instead of failing some parser test in a confusing way.
 */
import { z } from 'zod';
import {
  InstantSchema,
  ParsedReceiptSchema,
  ReceiptSourceSchema,
  type ParsedReceipt,
  type ReceiptSource,
} from '@/domain';

export type FixtureGroup = 'real' | 'synthetic';
export type SourceKind = ReceiptSource['kind'];

type FixtureSourceFor<K extends SourceKind> = {
  kind: K;
  source: Extract<ReceiptSource, { kind: K }>;
  /**
   * What a perfect parser returns for this source: `expected.<kind>.json` when the case needs a
   * different answer for this kind (for instance extra REPAIRED_DIGITS warnings on raw OCR),
   * otherwise the case's `expected.json`.
   */
  expected: ParsedReceipt;
};

/** A discriminated union: narrowing on `kind` narrows `source`. */
export type FixtureSource = { [K in SourceKind]: FixtureSourceFor<K> }[SourceKind];
export type FixtureSourceOf<K extends SourceKind> = Extract<FixtureSource, { kind: K }>;

export interface Fixture {
  /** Directory name, unique across groups, e.g. `kaufland-2026-11-07`. */
  id: string;
  group: FixtureGroup;
  description: string;
  notes: string[];
  /** Injectable clock (ISO instant). Pass it to anything that validates dates. */
  now: string;
  /** Ground truth shared by all sources of the case. */
  expected: ParsedReceipt;
  /** One entry per `source.<kind>.json`, ordered pdf-text, ocr-text, pasted-text. */
  sources: FixtureSource[];
}

const SOURCE_KINDS = [
  'pdf-text',
  'ocr-text',
  'pasted-text',
] as const satisfies readonly SourceKind[];

const CaseSchema = z.strictObject({
  description: z.string().min(1),
  origin: z.enum(['real', 'synthetic']),
  now: InstantSchema,
  notes: z.array(z.string().min(1)).optional(),
});

const FILE_PATTERN =
  /^\.\/(?<group>real|synthetic)\/(?<id>[^/]+)\/(?<name>case|expected|(?:source|expected)\.(?:pdf-text|ocr-text|pasted-text))\.json$/;

function parseFile<T>(schema: z.ZodType<T>, value: unknown, path: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid fixture file ${path}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

interface RawCase {
  group: FixtureGroup;
  id: string;
  files: Map<string, { path: string; json: unknown }>;
}

function groupFiles(files: Record<string, unknown>): RawCase[] {
  const cases = new Map<string, RawCase>();
  for (const [path, json] of Object.entries(files)) {
    const { group, id, name } = FILE_PATTERN.exec(path)?.groups ?? {};
    if (!group || !id || !name) throw new Error(`Unexpected file in tests/fixtures: ${path}`);
    const key = `${group}/${id}`;
    const entry = cases.get(key) ?? { group: group as FixtureGroup, id, files: new Map() };
    entry.files.set(name, { path, json });
    cases.set(key, entry);
  }
  return [...cases.values()];
}

function buildFixture(raw: RawCase): Fixture {
  const where = `${raw.group}/${raw.id}`;
  const need = (name: string) => {
    const file = raw.files.get(name);
    if (!file) throw new Error(`Fixture ${where} is missing ${name}.json`);
    return file;
  };

  const caseFile = need('case');
  const meta = parseFile(CaseSchema, caseFile.json, caseFile.path);
  if (meta.origin !== raw.group) {
    throw new Error(
      `${caseFile.path}: origin "${meta.origin}" does not match the folder "${raw.group}"`,
    );
  }

  const expectedFile = need('expected');
  const expected = parseFile(ParsedReceiptSchema, expectedFile.json, expectedFile.path);

  const sources = SOURCE_KINDS.flatMap((kind): FixtureSource[] => {
    const sourceFile = raw.files.get(`source.${kind}`);
    if (!sourceFile) return [];
    const source = parseFile(ReceiptSourceSchema, sourceFile.json, sourceFile.path);
    if (source.kind !== kind) {
      throw new Error(`${sourceFile.path}: contains a "${source.kind}" source`);
    }
    const override = raw.files.get(`expected.${kind}`);
    const entry = {
      kind,
      source,
      expected: override ? parseFile(ParsedReceiptSchema, override.json, override.path) : expected,
    };
    return [entry as FixtureSource]; // `source.kind === kind` was checked above
  });
  if (sources.length === 0) throw new Error(`Fixture ${where} has no source.<kind>.json`);

  return {
    id: raw.id,
    group: raw.group,
    description: meta.description,
    notes: meta.notes ?? [],
    now: meta.now,
    expected,
    sources,
  };
}

const rawFiles = import.meta.glob<unknown>('./{real,synthetic}/*/*.json', {
  eager: true,
  import: 'default',
});

/** Real samples first, then synthetic cases; alphabetical within each group. */
export const fixtures: readonly Fixture[] = groupFiles(rawFiles)
  .map(buildFixture)
  .sort((a, b) => a.group.localeCompare(b.group) || a.id.localeCompare(b.id));

const duplicates = fixtures.filter(
  (fixture, index) => fixtures.findIndex((f) => f.id === fixture.id) !== index,
);
if (duplicates.length > 0) {
  throw new Error(`Duplicate fixture ids: ${duplicates.map((fixture) => fixture.id).join(', ')}`);
}

export function getFixture(id: string): Fixture {
  const fixture = fixtures.find((candidate) => candidate.id === id);
  if (!fixture) {
    throw new Error(`Unknown fixture "${id}". Available: ${fixtures.map((f) => f.id).join(', ')}`);
  }
  return fixture;
}

/** The source of a given kind, typed accordingly. Throws when the case does not have one. */
export function sourceOf<K extends SourceKind>(fixture: Fixture, kind: K): FixtureSourceOf<K> {
  const found = fixture.sources.find(
    (candidate): candidate is FixtureSourceOf<K> => candidate.kind === kind,
  );
  if (!found) {
    const have = fixture.sources.map((candidate) => candidate.kind).join(', ');
    throw new Error(`Fixture "${fixture.id}" has no ${kind} source (it has: ${have})`);
  }
  return found;
}

/**
 * Drops what a golden comparison must ignore: which engine and parser version produced the
 * receipt, confidences, source regions, raw text, warning wording and warning order. Everything
 * else (including warning codes and line indexes) has to match exactly:
 *
 *   expect(normalizeForGolden(parse(source))).toEqual(normalizeForGolden(expected));
 */
export function normalizeForGolden(receipt: ParsedReceipt): ParsedReceipt {
  const warnings = receipt.meta.warnings
    .map(({ code, lineIdx }) => ({
      code,
      message: '',
      ...(lineIdx === undefined ? {} : { lineIdx }),
    }))
    .sort((a, b) => a.code.localeCompare(b.code) || (a.lineIdx ?? -1) - (b.lineIdx ?? -1));

  return {
    ...receipt,
    lines: receipt.lines.map(
      ({ confidence: _confidence, bbox: _bbox, raw: _raw, ...line }) => line,
    ),
    meta: { engine: 'fixture', parser: 'golden', parserVersion: '0.0.0', warnings },
  };
}
