/**
 * Leak check CLI.
 *
 *   node scripts/check-leaks.ts --staged   files staged for commit, as staged (pre-commit hook)
 *   node scripts/check-leaks.ts            every tracked file (CI, `npm run check:leaks`)
 *
 * The optional private denylist lives outside the repository (`~/.pretometru-private/denylist.txt`,
 * override with PRETOMETRU_DENYLIST). Findings print as `path:line:column rule` and never include
 * the matched value.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isScannablePath, parseDenylist, scanText } from './leak-check.ts';

const BINARY_PROBE_BYTES = 8000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const staged = process.argv.includes('--staged');

function git(args: string[]): Buffer {
  return execFileSync('git', args, {
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function listPaths(): string[] {
  const output = staged
    ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    : git(['ls-files', '-z']);
  return output.toString('utf8').split('\0').filter(Boolean);
}

function readContent(path: string): Buffer | undefined {
  try {
    return staged ? git(['show', `:${path}`]) : readFileSync(path);
  } catch {
    return undefined;
  }
}

function loadDenylist(): string[] {
  const path =
    process.env['PRETOMETRU_DENYLIST'] ?? join(homedir(), '.pretometru-private', 'denylist.txt');
  if (!existsSync(path)) {
    console.warn('leak-check: private denylist not found, using the generic rules only');
    return [];
  }
  return parseDenylist(readFileSync(path, 'utf8'));
}

function main(): number {
  const denylist = loadDenylist();
  let scanned = 0;
  let total = 0;

  for (const path of listPaths()) {
    if (!isScannablePath(path)) continue;
    const content = readContent(path);
    if (!content || content.length > MAX_FILE_BYTES) continue;
    if (content.subarray(0, BINARY_PROBE_BYTES).includes(0)) continue;

    scanned++;
    for (const finding of scanText(content.toString('utf8'), { denylist })) {
      total++;
      console.error(
        `${path}:${finding.line}:${finding.column}  ${finding.rule}  (${finding.excerpt})`,
      );
    }
  }

  if (total > 0) {
    console.error(
      `\nleak-check: ${total} possible leak(s) in ${scanned} file(s). Remove or sanitise the value; ` +
        'if the rule is wrong, fix it in scripts/leak-check.ts instead of bypassing the check.',
    );
    return 1;
  }
  console.log(`leak-check: ${scanned} file(s) clean`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`leak-check: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
