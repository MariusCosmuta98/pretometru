import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readPurchasedAt } from './dates';

const read = (...texts: string[]) => readPurchasedAt(texts.map((text) => ({ text })));
const at = (...texts: string[]) => read(...texts).purchasedAt;

describe('readPurchasedAt', () => {
  it.each([
    ['DATA:29/12/2026 ORA:17-12-30', '2026-12-29T17:12:30'],
    ['DATA:29/12/2026 0RA:17-12-38', '2026-12-29T17:12:38'],
    ['DATA 03.11.26 ORA 16:57:08', '2026-11-03T16:57:08'],
    ['DAT? 03.11.26 ORA 16:57:08', '2026-11-03T16:57:08'],
    ['Data: 7-3-2026 Ora: 9:05', '2026-03-07T09:05'],
    ['03.11.26', '2026-11-03'],
  ])('reads %j as %s', (text, expected) => {
    expect(at(text)).toBe(expected);
  });

  it('accepts letters that OCR reads in place of digits', () => {
    expect(at('DATA O3.l1.26 ORA 16:57:08')).toBe('2026-11-03T16:57:08');
  });

  it('is not fooled by amounts, codes and other numbers', () => {
    expect(at('TVA B 11,80% 2,73', '0000 000000/00', 'Casa:12', '5941234567890')).toBeUndefined();
  });

  it('only accepts real calendar dates and clock times', () => {
    expect(at('DATA 31.02.26 ORA 10:00')).toBeUndefined();
    expect(at('DATA 03.11.26 ORA 25:61')).toBe('2026-11-03');
  });

  it('prefers a date with a time over an earlier bare date (a card expiry, a promotion)', () => {
    expect(at('Valabil pana la 31.12.27', 'DATA 03.11.26 ORA 16:57:08')).toBe(
      '2026-11-03T16:57:08',
    );
    expect(at('Oferta pana la 31.12.26')).toBe('2026-12-31');
  });
});

describe('the time of a receipt', () => {
  it.each([
    ['DATA :01/02/2026 ORA:13-03-04', '2026-02-01T13:03:04'],
    ['DATA :01/02/2026 ORA:13:03:04', '2026-02-01T13:03:04'],
    ['DATA :01/02/2026 ORA:13:03', '2026-02-01T13:03'],
    ['DATA :01/02/2026 ORA :13-03-04', '2026-02-01T13:03:04'],
    ['DATA :01/02/2026 ORA: 13:03:04', '2026-02-01T13:03:04'],
    ['DATA :01/02/2026 ORA13:03:04', '2026-02-01T13:03:04'],
    ['DATA :01/02/2026 0RA:13-03-04', '2026-02-01T13:03:04'],
    ['Data: 01.02.26 Timp: 18:31:47 Bon: 12', '2026-02-01T18:31:47'],
    ['DATA :01/02/2026 ORA:13:03:04.', '2026-02-01T13:03:04'],
    ['DATA :01/02/2026 ORA:13:03:04 BON 12', '2026-02-01T13:03:04'],
    ['01/02/2026 13:03:04', '2026-02-01T13:03:04'],
    ['01/02/2026, 13:03', '2026-02-01T13:03'],
    ['DATA :01/02/2026 ORA:O9:l5:3O', '2026-02-01T09:15:30'],
  ])('reads %j as %s', (text, expected) => {
    expect(read(text)).toEqual({ purchasedAt: expected, warnings: [] });
  });

  it('does not make up a time from the tail of a damaged clock (`1/-03-04` is not `03:04`)', () => {
    const damaged = read('DATA :01/02/2026 ORA:1/-03-04');

    expect(damaged.purchasedAt).toBe('2026-02-01');
    expect(damaged.warnings).toEqual([
      {
        code: 'LOW_CONFIDENCE',
        message: 'Ora bonului nu a putut fi citită; s-a păstrat doar data. Verifică ora pe bon.',
      },
    ]);
    expect(at('DATA :01/02/2026 ORA:13-03-04')).toBe('2026-02-01T13:03:04');
  });

  it.each([
    ['a digit read as a slash', 'ORA:1/-03-04'],
    ['a digit read as a dot', 'ORA:1.-03-04'],
    ['an extra digit in the hour', 'ORA:123:04:05'],
    ['a digit lost, a space left behind', 'ORA:1 -03-04'],
    ['a colon where a digit was', 'ORA:1 :03:04'],
    ['a stray letter inside the hour', 'ORA:1Q3-03-04'],
    ['a lost separator', 'ORA:1303-04'],
    ['an extra group', 'ORA:13:03:04:05'],
    ['unreadable seconds', 'ORA:13-03-3Q'],
    ['two separators in a row', 'ORA:13::03:04'],
  ])('keeps the date and drops the time when there is %s (%s)', (_what, clock) => {
    const reading = read(`DATA :01/02/2026 ${clock}`);

    expect(reading.purchasedAt).toBe('2026-02-01');
    expect(reading.warnings.map((warning) => warning.code)).toEqual(['LOW_CONFIDENCE']);
  });

  it('reads no time either from a clock that is not a clock as a whole (no label to anchor it)', () => {
    // the comma sticks to the clock, which makes `13:03:04` and its tail `03:04` equally unsure
    expect(read('01/02/2026,13:03:04')).toEqual({ purchasedAt: '2026-02-01', warnings: [] });
    // `OR1` is a label misread: the `1` is not an hour, and 13:03:04 is not the answer either
    expect(read('DATA :01/02/2026 OR1:13:03:04')).toEqual({
      purchasedAt: '2026-02-01',
      warnings: [],
    });
  });

  it('says nothing when no time was printed: a date alone is a legitimate receipt', () => {
    for (const text of [
      'DATA :01/02/2026',
      'DATA :01/02/2026 ORA:',
      'DATA :01/02/2026 BON 0012-0034',
      'Oferta pana la 31.12.26',
    ]) {
      expect(read(text).warnings, text).toEqual([]);
    }
  });

  it('says a time was printed when it is out of range, and keeps the date', () => {
    const reading = read('DATA 03.11.26 ORA 25:61');

    expect(reading.purchasedAt).toBe('2026-11-03');
    expect(reading.warnings.map((warning) => warning.code)).toEqual(['LOW_CONFIDENCE']);
  });

  it('takes a clean time from another line over a damaged one, and then has nothing to say', () => {
    expect(read('DATA :01/02/2026 ORA:1/-03-04', 'DATA :01/02/2026 ORA:13-03-04')).toEqual({
      purchasedAt: '2026-02-01T13:03:04',
      warnings: [],
    });
  });
});

describe('the time of a receipt (properties)', () => {
  const pad = (value: number) => String(value).padStart(2, '0');
  const DATE = 'DATA:01/02/2026';
  const DAY = '2026-02-01';

  // the digits that OCR reads as letters, and how a receipt introduces the time
  const LOOKALIKE: Readonly<Record<string, string>> = { '0': 'O', '1': 'l' };
  const LABELS_WITH_COLON = ['ORA:', 'ORA :', 'Ora: ', '0RA:', 'ORĂ:', 'TIMP:', 'Timp: '];
  const LABELS = [...LABELS_WITH_COLON, 'ORA ', 'ORA', ''];

  interface Clock {
    hour: number;
    minute: number;
    second: number;
    separator: string;
  }
  const clockArb: fc.Arbitrary<Clock> = fc.record({
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
    second: fc.integer({ min: 0, max: 59 }),
    separator: fc.constantFrom(':', '-'),
  });

  const hhmm = ({ hour, minute }: Clock) => `${pad(hour)}:${pad(minute)}`;
  const printed = ({ hour, minute, second, separator }: Clock, withSeconds: boolean) =>
    [pad(hour), pad(minute), ...(withSeconds ? [pad(second)] : [])].join(separator);
  const line = (label: string, clock: string) => `${DATE} ${label}${clock}`;

  it('reads every clean clock back exactly, whatever the label and the letters read for digits', () => {
    fc.assert(
      fc.property(
        clockArb,
        fc.boolean(),
        fc.constantFrom(...LABELS),
        fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
        (clock, withSeconds, label, lookalikes) => {
          const clean = printed(clock, withSeconds);
          const text = [...clean]
            .map((char, at) => (lookalikes[at] ? (LOOKALIKE[char] ?? char) : char))
            .join('');
          const expected = `${DAY}T${withSeconds ? `${hhmm(clock)}:${pad(clock.second)}` : hhmm(clock)}`;

          expect(read(line(label, text)), line(label, text)).toEqual({
            purchasedAt: expected,
            warnings: [],
          });
        },
      ),
      { numRuns: 500 },
    );
  });

  // One character of the clock is replaced, one is added, or a separator is lost. Whatever
  // happens, the receipt keeps its date and the time is the clock as printed (whole, or as far as
  // `hh:mm`) or nothing: never the tail of the damaged clock. A label without its own colon is
  // left out: `ORA :3:03:04` is a fine reading of `ORA 13:03:04` with the `1` replaced by a colon.
  const JUNK = [...'/.,|;:-QZ!_#*'];
  const damageArb = fc.oneof(
    fc.record({
      kind: fc.constant('replace' as const),
      at: fc.nat(),
      junk: fc.constantFrom(...JUNK),
    }),
    fc.record({
      kind: fc.constant('insert' as const),
      at: fc.nat(),
      junk: fc.constantFrom(...JUNK),
    }),
    fc.record({ kind: fc.constant('drop' as const), at: fc.nat() }),
  );

  it('never reads the tail of a damaged clock as the time', () => {
    fc.assert(
      fc.property(
        clockArb,
        fc.boolean(),
        fc.constantFrom(...LABELS_WITH_COLON),
        damageArb,
        (clock, withSeconds, label, damage) => {
          const chars = [...printed(clock, withSeconds)];
          const separators = withSeconds ? [2, 5] : [2];
          if (damage.kind === 'replace') chars[damage.at % chars.length] = damage.junk;
          else if (damage.kind === 'insert')
            chars.splice(damage.at % (chars.length + 1), 0, damage.junk);
          else chars.splice(separators[damage.at % separators.length] ?? 2, 1);
          const text = line(label, chars.join(''));

          const whole = withSeconds ? `${hhmm(clock)}:${pad(clock.second)}` : hhmm(clock);
          const allowed = [DAY, `${DAY}T${hhmm(clock)}`, `${DAY}T${whole}`];
          expect(allowed, text).toContain(read(text).purchasedAt);
        },
      ),
      { numRuns: 3000 },
    );
  });
});
