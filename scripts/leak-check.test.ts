import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { scanText } from './leak-check.ts';

// Leaky samples are assembled at runtime so that this file never contains a literal match
// (the repository scan would otherwise flag its own tests).

function withIbanCheckDigits(country: string, bban: string): string {
  const rearranged = `${bban}${country}00`;
  const digits = [...rearranged]
    .map((c) => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55)))
    .join('');
  let remainder = 0;
  for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  return `${country}${String(98 - remainder).padStart(2, '0')}${bban}`;
}

function withLuhnCheckDigit(partial: string): string {
  let sum = 0;
  [...partial].reverse().forEach((c, i) => {
    let d = Number(c);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  });
  return `${partial}${(10 - (sum % 10)) % 10}`;
}

const rules = (text: string, denylist: string[] = []) =>
  scanText(text, { denylist }).map((finding) => finding.rule);

describe('scanText: generic rules', () => {
  it('flags a real IBAN but not a code that merely looks like one', () => {
    const iban = withIbanCheckDigits('RO', 'RZBR0000060000000000');
    expect(rules(`Cont: ${iban}`)).toEqual(['iban']);
    expect(rules('Cod produs RO12ABCD1234567890123456')).toEqual([]);
  });

  it('flags card numbers (Luhn-valid, grouped or not) but not EANs or arbitrary digit runs', () => {
    const pan = withLuhnCheckDigit('411111111111111');
    expect(rules(`Plata ${pan}`)).toEqual(['card-number']);
    expect(rules(`Plata ${pan.replace(/(\d{4})(?=\d)/g, '$1 ')}`)).toEqual(['card-number']);
    expect(rules('EAN 5948792073282')).toEqual([]);
    expect(rules('Cod 1234567890123456')).toEqual([]);
  });

  it('does not mistake the long decimals of coordinates for card numbers', () => {
    const digits = withLuhnCheckDigit('411111111111111');
    expect(rules(`"x": 4.${digits}, "w": 26,${digits}`)).toEqual([]);
  });

  it('flags a masked card number with visible digits, but not an all-zero placeholder', () => {
    const masked = `${'#'.repeat(12)}${'4891'}`;
    expect(rules(`Card: ${masked}`)).toEqual(['card-number']);
    expect(rules(`Cod ${'527176'}${'*'.repeat(6)}${'4891'}`)).toEqual(['card-number']);
    expect(rules(`Kaufland Card XTRA: ${'x'.repeat(5)}0000`)).toEqual([]);
  });

  it('flags e-mail addresses and Romanian phone numbers, not prices, dates or EANs', () => {
    expect(rules(`contact ${['ion.popescu', 'example.com'].join('@')}`)).toEqual(['email']);
    expect(rules(`Tel ${['0721', '123', '456'].join(' ')}`)).toEqual(['phone']);
    expect(rules(`Tel ${['+40', '721', '123', '456'].join(' ')}`)).toEqual(['phone']);
    expect(rules(`TEL: ${['0264', '591000'].join('-')}`)).toEqual(['phone']);
    expect(rules('Total 363,41 LEI, 12.08.2026 19:33, EAN 5948792073282, Bon 0000000000')).toEqual(
      [],
    );
  });

  it('flags API and access tokens', () => {
    expect(rules(`t=${'ghp_'}${'a'.repeat(36)}`)).toEqual(['token']);
    expect(rules(`t=${'github_pat_'}${'A1b2'.repeat(10)}`)).toEqual(['token']);
    expect(rules(`k=${'AIza'}${'x'.repeat(35)}`)).toEqual(['token']);
    expect(rules(`k=${'-----BEGIN '}${'PRIVATE KEY-----'}`)).toEqual(['token']);
  });

  it('flags loyalty, card and client numbers after their label, but not payment amounts', () => {
    expect(rules(`Nr. client: ${'4821937'}`)).toEqual(['labelled-id']);
    expect(rules(`Lidl Plus ${'88123456'}`)).toEqual(['labelled-id']);
    expect(rules(`CNP: ${'1850101123456'}`)).toEqual(['labelled-id']);
    expect(rules('CARD 20,69')).toEqual([]);
    expect(rules('Card Online 2 363,41 LEI')).toEqual([]);
    expect(rules('Kaufland Card XTRA: xxxxx0000')).toEqual([]);
  });
});

describe('scanText: private denylist', () => {
  it('finds a listed term regardless of case and spacing', () => {
    expect(rules('Client:  ION   POPESCU, Str. Exemplu', ['Ion Popescu'])).toEqual(['denylist']);
    expect(rules('nothing to see', ['Ion Popescu'])).toEqual([]);
  });

  it('ignores terms too short to be meaningful and empty entries', () => {
    expect(rules('Lei 12,30 ron', ['ron', '', '  '])).toEqual([]);
  });
});

describe('scanText: reporting', () => {
  it('reports line and column and never prints the whole secret', () => {
    const token = `${'ghp_'}${'q'.repeat(36)}`;
    const [finding] = scanText(`first line\nkey = ${token}`);

    expect(finding).toMatchObject({ rule: 'token', line: 2, column: 7 });
    expect(finding?.excerpt).not.toContain(token);
    expect(finding?.excerpt).toContain('40 chars');
  });
});

describe('check-leaks CLI', () => {
  const script = fileURLToPath(new URL('./check-leaks.ts', import.meta.url));
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function repoWith(files: Record<string, string>) {
    dir = mkdtempSync(join(tmpdir(), 'pretometru-leaks-'));
    const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    git('add', '-A');
    return dir;
  }

  function run(cwd: string, args: string[], env: Record<string, string> = {}) {
    return spawnSync('node', [script, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, PRETOMETRU_DENYLIST: join(cwd, 'no-denylist.txt'), ...env },
    });
  }

  it('fails a commit that stages a secret and does not echo it', () => {
    const token = `${'ghp_'}${'z'.repeat(36)}`;
    const cwd = repoWith({ 'src/config.ts': `export const token = '${token}';\n` });
    const result = run(cwd, ['--staged']);

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('src/config.ts:1');
    expect(result.stdout + result.stderr).not.toContain(token);
  });

  it('passes a clean commit and ignores lockfiles and binary assets', () => {
    const cwd = repoWith({
      'src/a.ts': 'export const total = 36341;\n',
      'package-lock.json': `{"integrity":"${'ghp_'}${'a'.repeat(36)}"}\n`,
      'public/icon.png': `${'ghp_'}${'a'.repeat(36)}`,
    });
    expect(run(cwd, ['--staged']).status).toBe(0);
  });

  it('applies the private denylist from PRETOMETRU_DENYLIST', () => {
    const cwd = repoWith({
      'tests/fixture.json': '{"note":"cumparator Ion Popescu"}\n',
      'denylist.txt': '# private terms\nIon Popescu\n',
    });
    const result = run(cwd, ['--staged'], { PRETOMETRU_DENYLIST: join(cwd, 'denylist.txt') });

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('denylist');
    expect(result.stdout + result.stderr).not.toContain('Popescu');
  });

  it('scans staged content, not later working-tree edits', () => {
    const cwd = repoWith({ 'notes.md': 'all good\n' });
    writeFileSync(join(cwd, 'notes.md'), `leaked ${['jane', 'example.com'].join('@')}\n`);
    expect(run(cwd, ['--staged']).status).toBe(0);
  });
});
