/**
 * Builds the committed fixture sources from the private extractions of the real receipts.
 *
 *   node scripts/sanitize-fixtures.ts [case-id ...]
 *
 * Reads  ~/.pretometru-private/extracted/<file>   (never committed; override with PRETOMETRU_PRIVATE_DIR)
 * Writes tests/fixtures/real/<id>/source.<kind>.json
 * Writes ~/.pretometru-private/denylist.txt        (the removed words and numbers, for check-leaks)
 *
 * Without case ids every fixture and the denylist are rebuilt from scratch; with ids only those
 * cases are rewritten and their terms are merged into the existing denylist.
 *
 * Prints counts only, never the removed text. Extraction itself needs pdfjs-dist / tesseract.js and
 * is documented in tests/fixtures/README.md.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { RECIPES, type Recipe } from './fixture-recipes.ts';
import { isScannablePath, parseDenylist } from './leak-check.ts';
import {
  denylistTerms,
  formatFixtureJson,
  pastedFromOcr,
  sanitizeOcrText,
  sanitizePdfText,
  type OcrSource,
  type PastedSource,
  type PdfSource,
  type Removed,
} from './sanitize.ts';

const privateDir = process.env['PRETOMETRU_PRIVATE_DIR'] ?? join(homedir(), '.pretometru-private');
const denylistPath = join(privateDir, 'denylist.txt');

const hasKind = (value: unknown, kind: string): boolean =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === kind;
const isPdfSource = (value: unknown): value is PdfSource => hasKind(value, 'pdf-text');
const isOcrSource = (value: unknown): value is OcrSource => hasKind(value, 'ocr-text');

const foldText = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Everything that is (or is about to be) in the repository: words found there are not secrets. */
function repositoryCorpus(): string {
  const listing = execFileSync('git', [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ])
    .toString('utf8')
    .split('\0')
    .filter((path) => path !== '' && isScannablePath(path) && existsSync(path));
  return foldText(listing.map((path) => readFileSync(path, 'utf8')).join('\n'));
}

function sanitizeRecipe(recipe: Recipe): { terms: string[]; changed: number } {
  const raw: unknown = JSON.parse(
    readFileSync(join(privateDir, 'extracted', recipe.extraction), 'utf8'),
  );

  let result: { source: PdfSource | OcrSource; removed: Removed[]; kept: string[] };
  let pasted: PastedSource | undefined;
  if (recipe.kind === 'pdf-text') {
    if (!isPdfSource(raw)) throw new Error(`${recipe.extraction} is not a pdf-text extraction`);
    const { source, removed } = sanitizePdfText(raw, recipe.rules);
    const kept = source.pages.flatMap((page) => page.items.map((item) => item.str));
    result = { source, removed, kept };
  } else {
    if (!isOcrSource(raw)) throw new Error(`${recipe.extraction} is not an ocr-text extraction`);
    const { source, removed } = sanitizeOcrText(raw, recipe.rules);
    result = { source, removed, kept: source.lines?.map((line) => line.text) ?? [source.text] };
    if (recipe.pasted) pasted = pastedFromOcr(source, recipe.pasted);
  }

  const directory = join('tests', 'fixtures', 'real', recipe.id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `source.${recipe.kind}.json`), formatFixtureJson(result.source));
  if (pasted) writeFileSync(join(directory, 'source.pasted-text.json'), formatFixtureJson(pasted));

  return { terms: denylistTerms(result.removed, result.kept), changed: result.removed.length };
}

function main(): void {
  const wanted = process.argv.slice(2);
  const recipes = RECIPES.filter((recipe) => wanted.length === 0 || wanted.includes(recipe.id));
  if (recipes.length === 0) throw new Error('No recipe matches the given case ids');

  // No case ids: rebuild every fixture and the denylist from scratch. With ids: merge into it.
  const terms = new Set(
    wanted.length === 0 || !existsSync(denylistPath)
      ? []
      : parseDenylist(readFileSync(denylistPath, 'utf8')),
  );
  for (const recipe of recipes) {
    const result = sanitizeRecipe(recipe);
    result.terms.forEach((term) => terms.add(term));
    console.log(
      `${recipe.id}: ${result.changed} piece(s) of text rewritten, ${result.terms.length} term(s) collected`,
    );
  }

  const corpus = repositoryCorpus();
  const kept = [...terms].filter((term) => !corpus.includes(term)).sort();
  mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    denylistPath,
    `# Private: words and numbers removed from real receipts. Never commit.\n${kept.join('\n')}\n`,
    { mode: 0o600 },
  );
  chmodSync(denylistPath, 0o600);
  console.log(
    `denylist: ${kept.length} term(s) (${terms.size - kept.length} dropped as already public in the repository)`,
  );
}

try {
  main();
} catch (error) {
  console.error(`sanitize-fixtures: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
