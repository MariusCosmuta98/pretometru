import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  buttonPrimary,
  buttonSecondary,
  card,
  inputClass,
  labelClass,
  noticeClass,
} from '@/ui/controls';
import { ERROR_MESSAGES, PHASE_LABELS } from './messages';
import { useImportRunner, type ImportJob, type NamedInput } from './useImportRunner';

interface FilePickerProps {
  label: string;
  accept: string;
  capture?: 'environment';
  multiple?: boolean;
  disabled: boolean;
  onFiles: (files: File[]) => void;
}

/** A button-looking label around a visually hidden file input, so it stays keyboard and screen-reader accessible. */
function FilePicker({ label, accept, capture, multiple, disabled, onFiles }: FilePickerProps) {
  return (
    <label
      className={`${buttonSecondary} relative cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-teal-600 ${
        disabled ? 'pointer-events-none opacity-50' : ''
      }`}
    >
      {label}
      <input
        type="file"
        className="sr-only"
        accept={accept}
        capture={capture}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          // Lets the same file be picked again after an error.
          event.currentTarget.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
    </label>
  );
}

function progressText(job: ImportJob): string {
  if (!job.progress) return 'Așteaptă…';
  const percent =
    job.progress.fraction === undefined ? '' : ` ${Math.round(job.progress.fraction * 100)}%`;
  return `${PHASE_LABELS[job.progress.phase]}…${percent}`;
}

export function Component() {
  const navigate = useNavigate();
  const runner = useImportRunner();
  const resultsRef = useRef<HTMLElement>(null);
  const [text, setText] = useState('');
  const [textMissing, setTextMissing] = useState(false);

  async function run(items: NamedInput[]) {
    const finished = await runner.start(items);
    const [only] = finished;
    // A single receipt goes straight to its review; several are listed so each can be opened.
    if (finished.length === 1 && only?.status === 'done' && only.receiptId) {
      await navigate(`/bonuri/${only.receiptId}`);
    }
  }

  function submitText(event: FormEvent) {
    event.preventDefault();
    if (text.trim() === '') {
      setTextMissing(true);
      return;
    }
    setTextMissing(false);
    void run([{ label: 'Text lipit', input: { kind: 'text', text } }]);
  }

  const runningIndex = runner.jobs.findIndex((job) => job.status === 'running');
  const runningJob = runner.jobs[runningIndex];
  const finished = !runner.running && runner.jobs.length > 0;

  // The results replace the progress panel: move focus there so the outcome is announced.
  useEffect(() => {
    if (finished) resultsRef.current?.focus();
  }, [finished]);

  return (
    <div className="space-y-4">
      <section aria-labelledby="add-file-title" className={card}>
        <h2 id="add-file-title" className="font-semibold">
          Din fișier sau poză
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          PDF, captură de ecran sau poza bonului. Bonul se citește pe dispozitivul tău; imaginea nu
          este trimisă nicăieri și nu se păstrează după verificare.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <FilePicker
            label="Alege fișiere"
            accept="application/pdf,image/*,text/plain,.pdf,.txt"
            multiple
            disabled={runner.running}
            onFiles={(files) => {
              void run(
                files.map((file) => ({
                  label: file.name || 'Fișier',
                  input: { kind: 'file', file },
                })),
              );
            }}
          />
          <FilePicker
            label="Fotografiază bonul"
            accept="image/*"
            capture="environment"
            disabled={runner.running}
            onFiles={(files) => {
              void run(
                files.map((file) => ({
                  label: file.name || 'Poză',
                  input: { kind: 'file', file },
                })),
              );
            }}
          />
        </div>
      </section>

      <section aria-labelledby="add-text-title" className={card}>
        <h2 id="add-text-title" className="font-semibold">
          Text lipit
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Copiază textul bonului (de exemplu cu „Text live” sau Google Lens) și lipește-l aici. Nu
          include numere de card sau de client.
        </p>
        <form onSubmit={submitText} className="mt-3 space-y-3" noValidate>
          <div>
            <label htmlFor="pasted-text" className={labelClass}>
              Textul bonului
            </label>
            <textarea
              id="pasted-text"
              rows={6}
              value={text}
              disabled={runner.running}
              aria-invalid={textMissing}
              aria-describedby={textMissing ? 'pasted-text-error' : undefined}
              onChange={(event) => {
                setText(event.target.value);
                if (textMissing) setTextMissing(false);
              }}
              className={`${inputClass} font-mono text-sm`}
            />
            {textMissing ? (
              <p
                id="pasted-text-error"
                role="alert"
                className="mt-1 text-sm text-red-700 dark:text-red-300"
              >
                Lipește mai întâi textul bonului.
              </p>
            ) : null}
          </div>
          <button type="submit" className={buttonPrimary} disabled={runner.running}>
            Citește textul
          </button>
        </form>
      </section>

      <section aria-labelledby="add-manual-title" className={card}>
        <h2 id="add-manual-title" className="font-semibold">
          Manual
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Introdu singur magazinul, data și produsele, de exemplu pentru un bon care nu se poate
          citi.
        </p>
        <Link to="/bonuri/nou" className={`${buttonSecondary} mt-3`}>
          Introdu bonul manual
        </Link>
      </section>

      {runner.running ? (
        <section
          role="status"
          aria-live="polite"
          aria-labelledby="import-progress-title"
          className={`${card} space-y-2`}
        >
          <h2 id="import-progress-title" className="font-semibold">
            Se citește bonul…
          </h2>
          {runningJob ? (
            <>
              <p className="text-sm">
                {runner.jobs.length > 1 ? `(${runningIndex + 1}/${runner.jobs.length}) ` : ''}
                <span className="font-medium">{runningJob.label}</span>: {progressText(runningJob)}
              </p>
              <progress
                aria-label="Progresul citirii"
                className="h-2 w-full accent-teal-700"
                max={1}
                value={runningJob.progress?.fraction}
              />
            </>
          ) : null}
          <button type="button" className={buttonSecondary} onClick={runner.cancel}>
            Anulează
          </button>
        </section>
      ) : null}

      {finished ? (
        <section
          ref={resultsRef}
          tabIndex={-1}
          aria-labelledby="import-results-title"
          className={`${card} space-y-2 outline-none`}
        >
          <h2 id="import-results-title" className="font-semibold">
            Rezultat
          </h2>
          <ul className="space-y-2">
            {runner.jobs.map((job) => (
              <li key={job.id}>
                {job.status === 'done' && job.receiptId ? (
                  <div className={noticeClass.success}>
                    <Link
                      to={`/bonuri/${job.receiptId}`}
                      className="font-medium underline underline-offset-2"
                    >
                      Verifică „{job.label}”
                    </Link>
                    {job.duplicate ? (
                      <p className="mt-1">Atenție: pare un duplicat al unui bon deja salvat.</p>
                    ) : null}
                  </div>
                ) : (
                  <p
                    role="alert"
                    className={job.status === 'cancelled' ? noticeClass.info : noticeClass.error}
                  >
                    <span className="font-medium">{job.label}:</span>{' '}
                    {ERROR_MESSAGES[job.error ?? 'UNKNOWN']}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
