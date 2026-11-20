import { useId, useRef, useState } from 'react';
import { applyBackup, readBackupFile, type BackupPreview, type ImportSummary } from '@/admin';
import type { ImportMode, PretometruDB } from '@/storage';
import { inputClass, labelClass, noticeClass } from '@/ui/controls';
import type { Live } from '@/ui/live';
import type { DeviceSummary } from './ExportPanel';
import { refusalMessage, type Message } from './messages';
import { PreviewCard } from './PreviewCard';
import { ResultCard } from './ResultCard';
import type { Exporter } from './useExporter';

type State =
  | { step: 'idle' }
  | { step: 'reading'; name: string }
  | { step: 'refused'; name: string; message: Message }
  | {
      step: 'preview';
      name: string;
      bytes: number;
      preview: BackupPreview;
      busy: boolean;
      error?: string;
    }
  | { step: 'done'; name: string; summary: ImportSummary };

/** Not enough room on the device: the one failure of an import a person can do something about. */
const isQuotaError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  error.name === 'QuotaExceededError';

const FAILED =
  'Importul nu a reușit, iar datele de pe acest dispozitiv nu au fost modificate. Încearcă din nou sau alege alt fișier.';
const NO_SPACE =
  'Nu este destul spațiu pe dispozitiv pentru acest import. Datele de pe acest dispozitiv nu au fost modificate. Fă loc și încearcă din nou.';

export function ImportPanel({
  db,
  device,
  exporter,
}: {
  db: PretometruDB;
  device: Live<DeviceSummary>;
  exporter: Exporter;
}) {
  const [state, setState] = useState<State>({ step: 'idle' });
  const headingId = useId();
  const inputId = useId();
  const helpId = useId();
  const input = useRef<HTMLInputElement>(null);

  async function choose(file: File) {
    setState({ step: 'reading', name: file.name });
    const result = await readBackupFile(file);
    setState(
      result.ok
        ? {
            step: 'preview',
            name: file.name,
            bytes: file.size,
            preview: result.preview,
            busy: false,
          }
        : { step: 'refused', name: file.name, message: refusalMessage(result.refusal) },
    );
  }

  async function run(mode: ImportMode) {
    if (state.step !== 'preview') return;
    const { name, bytes, preview } = state;
    setState({ step: 'preview', name, bytes, preview, busy: true });
    try {
      const summary = await applyBackup(db, preview.backup, mode);
      setState({ step: 'done', name, summary });
    } catch (error) {
      console.warn('The backup could not be imported', error);
      setState({
        step: 'preview',
        name,
        bytes,
        preview,
        busy: false,
        error: isQuotaError(error) ? NO_SPACE : FAILED,
      });
    }
  }

  function reset() {
    setState({ step: 'idle' });
    queueMicrotask(() => input.current?.focus());
  }

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h3 id={headingId} className="font-medium">
        Importă din fișier
      </h3>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Alege un fișier exportat mai înainte (se termină în .pretometru-backup.json), de exemplu
        după ce ai schimbat telefonul sau browserul. Vezi întâi ce conține; abia apoi se importă.
        Fișierul se citește pe acest dispozitiv, fără internet.
      </p>

      <div>
        <label htmlFor={inputId} className={labelClass}>
          Fișier de copie de siguranță
        </label>
        <input
          ref={input}
          id={inputId}
          type="file"
          accept=".json,application/json"
          aria-describedby={helpId}
          disabled={state.step === 'reading' || (state.step === 'preview' && state.busy)}
          className={`${inputClass} file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 dark:file:bg-slate-800`}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Clearing the value lets the same file be picked again after a refusal.
            event.target.value = '';
            if (file) void choose(file);
          }}
        />
        <p id={helpId} className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          Nimic nu se schimbă până nu confirmi.
        </p>
      </div>

      <div role="status">
        {state.step === 'reading' ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Se citește {state.name}…</p>
        ) : null}
      </div>

      {state.step === 'refused' ? (
        <div role="alert" className={`${noticeClass.error} space-y-1`}>
          <p className="font-medium">{state.message.text}</p>
          {state.message.hint ? <p>{state.message.hint}</p> : null}
          {state.message.details && state.message.details.length > 0 ? (
            <details>
              <summary className="cursor-pointer">Detalii tehnice</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 break-words">
                {state.message.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {state.step === 'preview' ? (
        <PreviewCard
          fileName={state.name}
          fileBytes={state.bytes}
          preview={state.preview}
          device={device}
          busy={state.busy}
          error={state.error}
          exporter={exporter}
          onImport={(mode) => {
            void run(mode);
          }}
          onCancel={reset}
        />
      ) : null}

      {state.step === 'done' ? <ResultCard summary={state.summary} onDone={reset} /> : null}
    </section>
  );
}
