import { useId } from 'react';
import type { TableCount } from '@/admin';
import { buttonPrimary, noticeClass } from '@/ui/controls';
import type { Live } from '@/ui/live';
import { formatBytes, formatWhen } from './format';
import { describeCounts, SKIPPED_TEXT, tableName } from './messages';
import type { Exporter } from './useExporter';

export interface DeviceSummary {
  /** What this device holds: what an export would contain. */
  counts: TableCount[];
  lastExportAt: string | undefined;
}

const muted = 'text-sm text-slate-600 dark:text-slate-400';

export function ExportPanel({
  device,
  exporter,
}: {
  device: Live<DeviceSummary>;
  exporter: Exporter;
}) {
  const headingId = useId();
  const summary = device.status === 'ready' ? device.value : undefined;
  const { done } = exporter;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h3 id={headingId} className="font-medium">
        Exportă datele
      </h3>
      <p className={muted}>
        Salvează într-un fișier tot ce ai în aplicație
        {summary ? ` (${describeCounts(summary.counts)})` : ''}. Fișierul rămâne la tine și nu se
        trimite nicăieri. Conține istoricul cumpărăturilor tale, așa că nu îl da mai departe.
      </p>
      {summary ? (
        <p className="text-sm">
          {summary.lastExportAt
            ? `Ultima exportare: ${formatWhen(summary.lastExportAt)}.`
            : 'Nu ai exportat încă o copie de pe acest dispozitiv.'}
        </p>
      ) : null}
      <button
        type="button"
        className={buttonPrimary}
        disabled={exporter.busy}
        onClick={() => {
          void exporter.run();
        }}
      >
        {exporter.busy ? 'Se pregătește fișierul…' : 'Exportă datele'}
      </button>

      <div role="status">
        {done ? (
          <div className={`${noticeClass.success} space-y-2`}>
            <p>
              Am pregătit fișierul <strong className="break-all">{done.fileName}</strong> (
              {formatBytes(done.bytes)}). Dacă nu apare în descărcări, verifică permisiunile
              browserului pentru descărcări. Păstrează-l într-un loc sigur: în Fișiere, pe Drive sau
              pe calculator.
            </p>
            {done.skipped.length > 0 ? (
              <div className="space-y-1">
                <p className="font-medium">{SKIPPED_TEXT}</p>
                <details>
                  <summary className="cursor-pointer">
                    Ce a fost lăsat deoparte ({done.skipped.length})
                  </summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {done.skipped.map((record) => (
                      <li key={`${record.table}/${record.id}`} className="break-all">
                        {tableName(record.table)}: {record.id} ({record.reason})
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {exporter.failed ? (
        <p role="alert" className={noticeClass.error}>
          Nu am putut pregăti fișierul. Datele tale nu au fost modificate. Încearcă din nou.
        </p>
      ) : null}
    </section>
  );
}
