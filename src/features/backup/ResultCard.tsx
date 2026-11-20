import { useEffect, useRef } from 'react';
import type { ImportSummary } from '@/admin';
import { buttonSecondary, card } from '@/ui/controls';
import { ignoredSettingsText, resultText, TABLE_NAMES } from './messages';

/** What an import did. Focus moves to its heading when it appears, so that it is read out. */
export function ResultCard({ summary, onDone }: { summary: ImportSummary; onDone: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section role="status" className={`${card} space-y-2`}>
      <h4 ref={heading} tabIndex={-1} className="font-medium outline-none">
        Import terminat
      </h4>
      <p>{resultText(summary)}</p>
      {summary.ignoredSettings > 0 ? <p>{ignoredSettingsText(summary.ignoredSettings)}</p> : null}
      <details>
        <summary className="cursor-pointer text-sm">Detalii pe tipuri</summary>
        <table className="mt-1 w-full text-sm">
          <caption className="sr-only">Ce s-a întâmplat cu fiecare tip de date</caption>
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th scope="col" className="py-1 text-left font-medium">
                Tip
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Noi
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Actualizate
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                La zi
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.tables
              .filter((change) => change.added + change.updated + change.unchanged > 0)
              .map((change) => (
                <tr key={change.table}>
                  <th scope="row" className="py-0.5 text-left font-normal">
                    {TABLE_NAMES[change.table]}
                  </th>
                  <td className="py-0.5 text-right tabular-nums">{change.added}</td>
                  <td className="py-0.5 text-right tabular-nums">{change.updated}</td>
                  <td className="py-0.5 text-right tabular-nums">{change.unchanged}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
      <button type="button" className={buttonSecondary} onClick={onDone}>
        Gata
      </button>
    </section>
  );
}
