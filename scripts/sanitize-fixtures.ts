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
import { dirname, join } from 'node:path';
import { PDF_RECIPES, type PdfRecipe } from './fixture-recipes.ts';
import { isScannablePath, parseDenylist } from './leak-check.ts';
import { denylistTerms, formatFixtureJson, sanitizePdfText, type PdfSource } from './sanitize.ts';

const privateDir = process.env['PRETOMETRU_PRIVATE_DIR'] ?? join(homedir(), '.pretometru-private');
const denylistPath = join(privateDir, 'denylist.txt');

const isPdfSource = (value: unknown): value is PdfSource =>
  typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'pdf-text';

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

function sanitizePdf(recipe: PdfRecipe): { terms: string[]; changed: number } {
  const raw: unknown = JSON.parse(
    readFileSync(join(privateDir, 'extracted', recipe.extraction), 'utf8'),
  );
  if (!isPdfSource(raw)) throw new Error(`${recipe.extraction} is not a pdf-text extraction`);

  const { source, removed } = sanitizePdfText(raw, recipe.rules);
  const kept = source.pages.flatMap((page) => page.items.map((item) => item.str));
  const target = join('tests', 'fixtures', 'real', recipe.id, `source.${recipe.kind}.json`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, formatFixtureJson(source));

  return { terms: denylistTerms(removed, kept), changed: removed.length };
}

function main(): void {
  const wanted = process.argv.slice(2);
  const recipes = PDF_RECIPES.filter((recipe) => wanted.length === 0 || wanted.includes(recipe.id));
  if (recipes.length === 0) throw new Error('No recipe matches the given case ids');

  // No case ids: rebuild every fixture and the denylist from scratch. With ids: merge into it.
  const terms = new Set(
    wanted.length === 0 || !existsSync(denylistPath)
      ? []
      : parseDenylist(readFileSync(denylistPath, 'utf8')),
  );
  for (const recipe of recipes) {
    const result = sanitizePdf(recipe);
    result.terms.forEach((term) => terms.add(term));
    console.log(
      `${recipe.id}: ${result.changed} item(s) rewritten, ${result.terms.length} term(s) collected`,
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
