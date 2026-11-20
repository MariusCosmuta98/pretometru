import { useEffect, useId, useRef, useState } from 'react';
import type { BackupPreview } from '@/admin';
import type { ImportMode } from '@/storage';
import { buttonPrimary, buttonQuiet, buttonSecondary, card, noticeClass } from '@/ui/controls';
import { ConfirmPanel } from '@/ui/ConfirmPanel';
import type { Live } from '@/ui/live';
import type { DeviceSummary } from './ExportPanel';
import { formatBytes, formatWhen } from './format';
import { describeCounts, TABLE_NAMES, warningText } from './messages';
import type { Exporter } from './useExporter';

const MODES: ReadonlyArray<{ mode: ImportMode; label: string; help: string }> = [
  {
    mode: 'merge',
    label: 'Îmbină cu datele de acum (recomandat)',
    help: 'Păstrează ce ai deja și adaugă ce lipsește. Dacă același element există în ambele locuri, rămâne varianta modificată mai recent; o ștergere mai nouă șterge elementul.',
  },
  {
    mode: 'replace',
    label: 'Înlocuiește tot',
    help: 'Șterge datele de pe acest dispozitiv și pune în loc conținutul fișierului. Setările dispozitivului (cheia Gemini, conexiunea GitHub) rămân.',
  },
];

/** What a chosen file holds, and the choice of how to import it. Nothing is written until "Importă". */
export function PreviewCard({
  fileName,
  fileBytes,
  preview,
  device,
  busy,
  error,
  exporter,
  onImport,
  onCancel,
}: {
  fileName: string;
  fileBytes: number;
  preview: BackupPreview;
  device: Live<DeviceSummary>;
  busy: boolean;
  error: string | undefined;
  exporter: Exporter;
  onImport: (mode: ImportMode) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<ImportMode>('merge');
  const [confirming, setConfirming] = useState(false);
  const headingId = useId();
  const groupName = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const rows = preview.counts.filter((count) => count.live > 0 || count.deleted > 0);
  const onDevice = device.status === 'ready' ? describeCounts(device.value.counts) : 'date';

  return (
    <section aria-labelledby={headingId} className={`${card} space-y-4`}>
      <h4 id={headingId} ref={heading} tabIndex={-1} className="font-medium outline-none">
        Fișierul ales
      </h4>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">Fișier</dt>
        <dd className="break-all">
          {fileName} ({formatBytes(fileBytes)})
        </dd>
        <dt className="font-medium">Exportat la</dt>
        <dd>{formatWhen(preview.exportedAt)}</dd>
        <dt className="font-medium">Versiunea formatului</dt>
        <dd>{preview.formatVersion}</dd>
      </dl>

      {rows.length > 0 ? (
        <div>
          <table className="w-full text-sm">
            <caption className="sr-only">Ce conține fișierul</caption>
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th scope="col" className="py-1 text-left font-medium">
                  Tip
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  În fișier
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Marcate ca șterse
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((count) => (
                <tr key={count.table}>
                  <th scope="row" className="py-0.5 text-left font-normal">
                    {TABLE_NAMES[count.table]}
                  </th>
                  <td className="py-0.5 text-right tabular-nums">{count.live}</td>
                  <td className="py-0.5 text-right tabular-nums">{count.deleted}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Ștergerile rămân în fișier ca să poată fi aplicate și pe alte dispozitive.
          </p>
        </div>
      ) : (
        <p className={noticeClass.info}>Fișierul este gol: nu conține nicio înregistrare.</p>
      )}

      {preview.warnings.length > 0 ? (
        <div className={`${noticeClass.warning} space-y-1`}>
          <ul className="list-disc space-y-0.5 pl-5">
            {preview.warnings.map((warning) => {
              const text = warningText(warning);
              return <li key={text}>{text}</li>;
            })}
          </ul>
          <p>
            Poți importa oricum: datele care lipsesc pot apărea mai târziu, de exemplu după o
            sincronizare.
          </p>
        </div>
      ) : null}

      <fieldset className="space-y-2" disabled={confirming || busy}>
        <legend className="mb-1 font-medium">Cum importi?</legend>
        {MODES.map((option) => (
          <label
            key={option.mode}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 has-[:checked]:border-teal-600 has-[:disabled]:opacity-70 dark:border-slate-700"
          >
            <input
              type="radio"
              name={groupName}
              value={option.mode}
              checked={mode === option.mode}
              onChange={() => {
                setMode(option.mode);
              }}
              className="mt-1 size-5 accent-teal-700"
            />
            <span>
              <span className="block font-medium">{option.label}</span>
              <span className="block text-sm text-slate-600 dark:text-slate-400">
                {option.help}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {error ? (
        <p role="alert" className={noticeClass.error}>
          {error}
        </p>
      ) : null}

      {confirming ? (
        <ConfirmPanel
          title="Înlocuiești datele de pe acest dispozitiv?"
          confirmLabel="Înlocuiește datele"
          busy={busy}
          // The question says what would be lost: wait until that is known (a moment at most).
          canConfirm={device.status !== 'loading'}
          onConfirm={() => {
            onImport('replace');
          }}
          onCancel={() => {
            setConfirming(false);
          }}
        >
          <p>
            Acum ai {onDevice}. Toate vor fi șterse de pe acest dispozitiv și înlocuite cu{' '}
            {describeCounts(preview.counts)} din fișier. Nu se poate anula.
          </p>
          <p>
            Dacă folosești sincronizarea cu GitHub, la următoarea sincronizare pot reapărea date din
            depozit.
          </p>
          <button
            type="button"
            className={buttonSecondary}
            disabled={exporter.busy || busy}
            onClick={() => {
              void exporter.run();
            }}
          >
            Descarcă mai întâi o copie a datelor de acum
          </button>
          {exporter.done ? (
            <p role="status" className="text-sm">
              Am pregătit fișierul <span className="break-all">{exporter.done.fileName}</span>.
            </p>
          ) : null}
        </ConfirmPanel>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonPrimary}
            disabled={busy || rows.length === 0}
            onClick={() => {
              if (mode === 'replace') setConfirming(true);
              else onImport('merge');
            }}
          >
            {busy ? 'Se importă…' : 'Importă datele'}
          </button>
          <button type="button" className={buttonQuiet} disabled={busy} onClick={onCancel}>
            Anulează
          </button>
        </div>
      )}
    </section>
  );
}
