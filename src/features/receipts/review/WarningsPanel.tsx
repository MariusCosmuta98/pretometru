import { Link } from 'react-router';
import { formatLei, type ParseWarning, type Receipt, type WarningCode } from '@/domain';
import { ACK_CODES, RECEIPT_REVIEW_KEY, type AckCode, type Acks, type Analysis } from '@/import';
import { buttonQuiet, card } from '@/ui/controls';
import { formatPurchasedAt, WARNING_TITLES } from '../labels';
import { ackDomId, ackLabel, noWarningsText } from './text';

export interface LineRef {
  id: string;
  /** 1-based position on screen. */
  number: number;
}

interface WarningsPanelProps {
  analysis: Analysis;
  acks: Acks;
  purchasedAt: string | undefined;
  duplicates: readonly Receipt[];
  /** The lines by printed index, to turn a warning's `lineIdx` into a line on screen. */
  lines: ReadonlyMap<number, LineRef>;
  /** After a failed confirmation: show the unaccepted warnings as what blocks it. */
  highlightPending: boolean;
  onAccept: (code: AckCode, token: string) => void;
  onWithdraw: (code: AckCode) => void;
  /** A line id, or `RECEIPT_REVIEW_KEY` for the receipt itself. */
  onVerify: (key: string) => void;
  onGoToLine: (lineId: string) => void;
}

const SEVERE: ReadonlySet<WarningCode> = new Set([
  'MISSING_TOTAL',
  'MISSING_DATE',
  'FUTURE_DATE',
  'DUPLICATE',
  'SUM_MISMATCH',
]);

const ackable = (code: WarningCode): code is AckCode =>
  (ACK_CODES as readonly string[]).includes(code);

function tone(code: WarningCode): string {
  return SEVERE.has(code)
    ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100'
    : 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100';
}

/**
 * Everything that looks off about the receipt, recomputed after every edit. FUTURE_DATE,
 * DUPLICATE and SUM_MISMATCH need the user's explicit acceptance before the receipt can be
 * confirmed; doubts left over from the import can be dismissed by verifying the line.
 */
export function WarningsPanel({
  analysis,
  acks,
  purchasedAt,
  duplicates,
  lines,
  highlightPending,
  onAccept,
  onWithdraw,
  onVerify,
  onGoToLine,
}: WarningsPanelProps) {
  const { warnings } = analysis;

  return (
    <section aria-labelledby="warnings-title" className={`${card} space-y-3`}>
      <h2 id="warnings-title" className="font-semibold">
        Avertismente{warnings.length > 0 ? ` (${warnings.length})` : ''}
      </h2>
      {warnings.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">{noWarningsText(analysis)}</p>
      ) : (
        <ul className="space-y-2">
          {warnings.map((warning: ParseWarning, index) => {
            const line = warning.lineIdx === undefined ? undefined : lines.get(warning.lineIdx);
            const token = ackable(warning.code) ? analysis.ackTokens[warning.code] : undefined;
            const code = ackable(warning.code) ? warning.code : undefined;
            const accepted = code !== undefined && token !== undefined && acks[code] === token;
            const pending = code !== undefined && token !== undefined && !accepted;
            return (
              <li
                key={`${warning.code}-${warning.lineIdx ?? 'doc'}-${index}`}
                className={`space-y-2 rounded-lg border p-3 text-sm ${
                  pending && highlightPending
                    ? 'border-red-400 bg-red-50 text-red-950 dark:border-red-700 dark:bg-red-950 dark:text-red-100'
                    : tone(warning.code)
                }`}
              >
                <p className="font-medium">
                  {WARNING_TITLES[warning.code]}
                  {line ? ` · linia ${line.number}` : ''}
                </p>
                <p>{warning.message}</p>

                {warning.code === 'DUPLICATE' ? (
                  <ul className="space-y-1">
                    {duplicates.map((receipt) => (
                      <li key={receipt.id}>
                        <Link to={`/bonuri/${receipt.id}`} className="font-medium underline">
                          Deschide bonul similar din {formatPurchasedAt(receipt.purchasedAt)} (
                          {formatLei(receipt.totalBani)})
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  {line ? (
                    <button
                      type="button"
                      className={buttonQuiet}
                      onClick={() => {
                        onGoToLine(line.id);
                      }}
                    >
                      Mergi la linia {line.number}
                    </button>
                  ) : null}
                  {analysis.dismissible.has(warning) ? (
                    <button
                      type="button"
                      className={buttonQuiet}
                      onClick={() => {
                        onVerify(line?.id ?? RECEIPT_REVIEW_KEY);
                      }}
                    >
                      {line ? `Am verificat linia ${line.number}` : 'Am verificat bonul'}
                    </button>
                  ) : null}
                </div>

                {code !== undefined && token !== undefined ? (
                  <label className="flex min-h-11 items-start gap-3">
                    <input
                      id={ackDomId(code)}
                      type="checkbox"
                      checked={accepted}
                      onChange={(event) => {
                        if (event.target.checked) onAccept(code, token);
                        else onWithdraw(code);
                      }}
                      className="mt-0.5 size-5 shrink-0 accent-teal-700"
                    />
                    <span>
                      {ackLabel(code, {
                        purchasedAt,
                        differenceBani: analysis.differenceBani,
                      })}
                    </span>
                  </label>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
