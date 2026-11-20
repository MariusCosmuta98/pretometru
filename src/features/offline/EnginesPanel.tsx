import { useCallback, useState } from 'react';
import type { EngineStatus, OfflineReadiness, PrepareProgress } from '@/pwa';
import { buttonPrimary, noticeClass } from '@/ui/controls';
import { formatBytes } from './format';
import { useOfflineEnv, useRead } from './hooks';

const LABELS: Record<string, string> = { pdf: 'Citire PDF', ocr: 'Citire din poze (OCR)' };

type Job =
  { phase: 'running'; progress?: PrepareProgress } | { phase: 'done' } | { phase: 'failed' };

function describe(engine: EngineStatus): string {
  if (engine.cached === engine.files) return 'gata fără internet';
  if (engine.cached === 0) return `se descarcă la prima folosire (${formatBytes(engine.bytes)})`;
  return `parțial: ${engine.cached} din ${engine.files} fișiere`;
}

const UNAVAILABLE: Record<OfflineReadiness, string> = {
  pending: 'Închide și redeschide aplicația o dată, apoi revino aici.',
  ready: 'Încearcă din nou peste câteva clipe.',
  unregistered: 'Descărcarea este disponibilă doar în versiunea publicată a aplicației.',
  unsupported: 'Acest browser nu permite folosirea aplicației fără internet.',
};

/**
 * PDFs and photos are read on the device, but the engines that read them (about 18 MB) are fetched
 * the first time they are used. Downloading them ahead, on Wi-Fi, makes importing work without a
 * connection the first time too.
 */
export function EnginesPanel({ readiness }: { readiness: OfflineReadiness | undefined }) {
  const env = useOfflineEnv();
  const read = useCallback(async () => ({ engines: await env.engines.status() }), [env]);
  const { value, refresh } = useRead(read, env.subscribeToController);
  const [job, setJob] = useState<Job>();

  const engines = (value?.engines ?? []).filter((engine) => engine.files > 0);
  const remaining = engines.reduce((sum, engine) => sum + engine.bytes - engine.cachedBytes, 0);
  const running = job?.phase === 'running';

  async function download() {
    setJob({ phase: 'running' });
    try {
      await env.engines.prepare((progress) => {
        setJob({ phase: 'running', progress });
      });
      setJob({ phase: 'done' });
    } catch (error) {
      console.warn('The engines could not be downloaded', error);
      setJob({ phase: 'failed' });
    } finally {
      refresh();
    }
  }

  const progress = job?.phase === 'running' ? job.progress : undefined;

  return (
    <div>
      <h3 className="font-medium">Citirea bonurilor fără internet</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        PDF-urile și pozele se citesc pe dispozitivul tău. Motoarele de citire se descarcă o singură
        dată, la prima folosire. Ca să poți citi bonuri și fără semnal, le poți descărca acum, de
        preferat pe Wi-Fi.
      </p>

      {value?.engines === undefined ? (
        value ? (
          <p className={`${noticeClass.info} mt-3`}>
            Citirea fără internet nu poate fi pregătită acum.{' '}
            {UNAVAILABLE[readiness ?? 'unregistered']}
          </p>
        ) : null
      ) : (
        <>
          <ul className="mt-3 space-y-1 text-sm">
            {engines.map((engine) => (
              <li key={engine.id}>
                <span className="font-medium">{LABELS[engine.id] ?? engine.id}:</span>{' '}
                {describe(engine)}
              </li>
            ))}
          </ul>

          {remaining > 0 && !running ? (
            <button
              type="button"
              className={`${buttonPrimary} mt-3`}
              onClick={() => {
                void download();
              }}
            >
              Descarcă acum ({formatBytes(remaining)})
            </button>
          ) : null}

          {running ? (
            <div role="status" className="mt-3 space-y-2 text-sm">
              <p>
                Se descarcă…
                {progress ? ` ${progress.doneFiles} din ${progress.totalFiles} fișiere` : ''}
              </p>
              <progress
                aria-label="Progresul descărcării"
                className="h-2 w-full accent-teal-700"
                max={1}
                value={progress ? progress.doneBytes / Math.max(progress.totalBytes, 1) : undefined}
              />
            </div>
          ) : null}

          {job?.phase === 'done' ? (
            <p role="status" className={`${noticeClass.success} mt-3`}>
              Gata: poți citi PDF-uri și poze și fără internet.
            </p>
          ) : null}
          {job?.phase === 'failed' ? (
            <p role="alert" className={`${noticeClass.error} mt-3`}>
              Descărcarea s-a oprit. Verifică conexiunea și încearcă din nou; ce s-a descărcat deja
              se păstrează.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
