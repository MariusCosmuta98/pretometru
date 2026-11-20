import { useCallback, useState } from 'react';
import { readPersistence, requestPersistence } from '@/pwa';
import { buttonSecondary, noticeClass } from '@/ui/controls';
import { formatBytes } from './format';
import { useOfflineEnv, useRead } from './hooks';

/**
 * The data lives in this browser. `storage.persist()` asks it not to delete the data when space runs
 * low; the browser decides (an installed app is usually granted), so the answer is shown and the ask
 * can be repeated. It is no substitute for a copy outside the browser.
 */
export function StoragePanel() {
  const env = useOfflineEnv();
  const read = useCallback(() => readPersistence(env.storage), [env]);
  const { value: state, refresh } = useRead(read);
  const [answer, setAnswer] = useState<boolean>();

  async function ask() {
    setAnswer(await requestPersistence(env.storage));
    refresh();
  }

  return (
    <div>
      <h3 className="font-medium">Stocarea datelor</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Bonurile, produsele și listele tale sunt salvate doar în acest browser. Dacă dispozitivul
        rămâne fără spațiu, browserul le poate șterge, în afară de cazul în care stocarea este
        persistentă.
      </p>

      {state ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="font-medium">Stocare persistentă</dt>
          <dd>
            {!state.supported
              ? 'indisponibilă în acest browser'
              : state.persisted === undefined
                ? 'necunoscută'
                : state.persisted
                  ? 'activă'
                  : 'neactivă'}
          </dd>
          {state.usageBytes !== undefined ? (
            <>
              <dt className="font-medium">Spațiu folosit</dt>
              <dd>
                {formatBytes(state.usageBytes)}
                {state.quotaBytes !== undefined ? ` din ${formatBytes(state.quotaBytes)}` : ''}
              </dd>
            </>
          ) : null}
          <dt className="font-medium">Instalată pe ecranul principal</dt>
          <dd>{state.installed ? 'da' : 'nu'}</dd>
        </dl>
      ) : null}

      {state?.supported && state.persisted !== true ? (
        <button
          type="button"
          className={`${buttonSecondary} mt-3`}
          onClick={() => {
            void ask();
          }}
        >
          Cere stocare persistentă
        </button>
      ) : null}

      {answer === true ? (
        <p role="status" className={`${noticeClass.success} mt-3`}>
          Browserul a acceptat: datele nu vor mai fi șterse automat.
        </p>
      ) : null}
      {answer === false ? (
        <p role="status" className={`${noticeClass.warning} mt-3`}>
          Browserul nu a acceptat acum. Instalează aplicația pe ecranul principal (din meniul
          browserului), folosește-o câteva zile și încearcă din nou.
        </p>
      ) : null}

      <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
        Stocarea persistentă nu ține loc de o copie de siguranță. Păstrează și o copie în afara
        browserului: exportă datele sau sincronizează-le cu depozitul tău GitHub privat (din aceste
        Setări).
      </p>
    </div>
  );
}
