import { describe, expect, it } from 'vitest';
import { formatLei } from '@/domain';
import { analyze, draftFromParsed } from '@/import';
import { fakeParser, sampleReceipt, testIds, testNow } from '@/import/testing';
import { SUM_TOLERANCE_BANI } from '@/parsers';
import { noWarningsText, sumStatusText } from './text';

// The sum line and the warnings panel read the same verdict: whatever the difference, they must
// tell the same story, also where the real validation would not leave the panel empty.
describe('the two messages about the sum of the lines', () => {
  const draft = draftFromParsed(sampleReceipt(), { kind: 'pdf' }, testIds);
  const analysis = (differenceBani: number) =>
    analyze(
      { ...draft, totalBani: draft.totalBani - differenceBani },
      { parser: fakeParser(sampleReceipt()), now: testNow(), duplicates: [], reviewed: new Set() },
    );

  const differences = Array.from(
    { length: 4 * SUM_TOLERANCE_BANI + 1 },
    (_, index) => index - 2 * SUM_TOLERANCE_BANI,
  );

  it.each(differences)('agree about a difference of %i bani', (differenceBani) => {
    const status = sumStatusText(analysis(differenceBani));
    const panel = noWarningsText(analysis(differenceBani));
    const signed = `${differenceBani > 0 ? '+' : '−'}${formatLei(Math.abs(differenceBani))}`;
    const limit = `±${formatLei(SUM_TOLERANCE_BANI)}`;

    if (differenceBani === 0) {
      expect(status).toBe('se potrivesc');
      expect(panel).toBe('Nu am găsit nicio problemă: suma liniilor se potrivește cu totalul.');
      return;
    }

    // Both name the signed difference and the limit, and never say that the sums match.
    for (const text of [status, panel]) {
      expect(text).toContain(signed);
      expect(text).toContain(limit);
      expect(text).not.toMatch(/se potrivesc|se potrivește/);
    }
    if (Math.abs(differenceBani) <= SUM_TOLERANCE_BANI) {
      expect(status).toContain('acceptată (în limita de');
      expect(panel).toContain('Nu am găsit nicio problemă');
      expect(panel).toContain('în limita acceptată');
      expect(`${status} ${panel}`).not.toContain('peste');
    } else {
      expect(status).toContain('peste limita de');
      expect(panel).toContain('peste limita acceptată');
      expect(`${status} ${panel}`).not.toMatch(/acceptată \(|Nu am găsit nicio problemă/);
    }
  });
});
