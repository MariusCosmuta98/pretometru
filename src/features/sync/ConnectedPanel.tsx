import { useId, useState, type FormEvent } from 'react';
import {
  disconnect,
  getSyncServices,
  isBlockingCode,
  runSync,
  setAutoSync,
  unlockToken,
  type Connection,
  type SyncView,
} from '@/sync';
import {
  buttonDanger,
  buttonPrimary,
  buttonQuiet,
  buttonSecondary,
  inputClass,
  labelClass,
  noticeClass,
} from '@/ui/controls';
import { ConnectForm } from './ConnectForm';
import { formatWhen } from './format';
import { errorMessage, PHASE_LABELS, successText, toFailure, type Failure } from './messages';
import { useSyncRuntime } from './useSync';

interface Props {
  view: SyncView & { connection: Connection };
}

function UnlockForm() {
  const id = useId();
  const [passphrase, setPassphrase] = useState('');
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);

  async function unlock(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setWrong(false);
    try {
      const services = getSyncServices();
      await unlockToken(await services.getDb(), passphrase);
    } catch {
      setWrong(true);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void unlock(event)} className="space-y-2">
      <p className="text-sm">
        Tokenul este protejat cu o parolă. Introdu-o ca să poți sincroniza; aplicația o cere o dată
        la fiecare pornire.
      </p>
      <label htmlFor={id} className={labelClass}>
        Parola tokenului
      </label>
      <input
        id={id}
        type="password"
        autoComplete="current-password"
        className={inputClass}
        value={passphrase}
        disabled={busy}
        onChange={(event) => setPassphrase(event.target.value)}
      />
      {wrong ? (
        <p role="alert" className={noticeClass.error}>
          Parola nu este corectă.
        </p>
      ) : null}
      <button type="submit" className={buttonSecondary} disabled={busy || passphrase === ''}>
        Deblochează
      </button>
    </form>
  );
}

function FailureAlert({ failure }: { failure: Failure }) {
  return (
    <p role="alert" className={noticeClass.error}>
      {errorMessage(failure.code, failure.retryAt)}
      {failure.code === 'REMOTE_INVALID' && failure.detail ? (
        <>
          {' '}
          Fișier: <code>{failure.detail}</code>
        </>
      ) : null}
    </p>
  );
}

export function ConnectedPanel({ view }: Props) {
  const { connection, protection, status, unsynced } = view;
  const runtime = useSyncRuntime();
  const autoId = useId();
  const [failure, setFailure] = useState<Failure>();
  const [changingToken, setChangingToken] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const locked = protection === 'passphrase' && !runtime.unlocked;

  async function syncNow() {
    setFailure(undefined);
    try {
      await runSync();
    } catch (error) {
      setFailure(toFailure(error));
    }
  }

  async function toggleAuto(on: boolean) {
    const services = getSyncServices();
    await setAutoSync(await services.getDb(), on, services);
  }

  async function disconnectNow() {
    const services = getSyncServices();
    await disconnect(await services.getDb(), services);
  }

  const shownFailure: Failure | undefined =
    failure ?? (status && !status.ok && status.error ? status.error : undefined);
  // Automatic sync does not retry what retrying cannot fix: it waits for a manual sync that works.
  const paused =
    connection.auto &&
    status !== undefined &&
    !status.ok &&
    status.error !== undefined &&
    isBlockingCode(status.error.code);

  return (
    <div className="space-y-4">
      <p className="text-sm">
        Conectat la{' '}
        <strong>
          {connection.owner}/{connection.repo}
        </strong>{' '}
        (depozit privat). Tokenul rămâne doar pe acest dispozitiv
        {protection === 'passphrase' ? ', criptat cu parola ta' : ''}.
      </p>

      <div role="status" aria-live="polite" className="space-y-1 text-sm">
        {runtime.running ? (
          <p className={noticeClass.info}>{PHASE_LABELS[runtime.phase ?? 'checking']}…</p>
        ) : status?.success ? (
          <>
            <p>
              Ultima sincronizare reușită: <strong>{formatWhen(status.success.at)}</strong>.{' '}
              {successText(status.success)}
            </p>
            {unsynced ? (
              <p className="text-amber-800 dark:text-amber-300">
                Ai modificări care nu au fost încă trimise în depozit.
              </p>
            ) : null}
          </>
        ) : (
          <p>Încă nu s-a sincronizat nimic de pe acest dispozitiv.</p>
        )}
      </div>

      {shownFailure && !runtime.running ? <FailureAlert failure={shownFailure} /> : null}
      {paused && !runtime.running ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Sincronizarea automată este oprită până când o sincronizare reușește. Rezolvă problema de
          mai sus și apasă „Sincronizează acum”.
        </p>
      ) : null}

      {locked ? <UnlockForm /> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonPrimary}
          disabled={runtime.running || locked}
          onClick={() => void syncNow()}
        >
          Sincronizează acum
        </button>
      </div>

      <div className="flex min-h-11 items-start gap-2">
        <input
          id={autoId}
          type="checkbox"
          className="mt-1 size-5 accent-teal-700"
          checked={connection.auto}
          onChange={(event) => void toggleAuto(event.target.checked)}
        />
        <label htmlFor={autoId} className="text-sm">
          Sincronizare automată
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            La pornirea aplicației, când te întorci în ea, când ești din nou online și la câteva
            secunde după ce modifici date. Oprește-o dacă preferi să sincronizezi doar manual.
          </span>
        </label>
      </div>

      {changingToken ? (
        <ConnectForm
          mode="update"
          repoDefault={`${connection.owner}/${connection.repo}`}
          onCancel={() => setChangingToken(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonSecondary} onClick={() => setChangingToken(true)}>
            Schimbă tokenul
          </button>
          {confirmingDisconnect ? null : (
            <button
              type="button"
              className={buttonQuiet}
              onClick={() => setConfirmingDisconnect(true)}
            >
              Deconectează
            </button>
          )}
        </div>
      )}

      {confirmingDisconnect ? (
        <div role="group" aria-label="Confirmă deconectarea" className={noticeClass.warning}>
          <p>
            Ștergi tokenul de pe acest dispozitiv? Datele de pe dispozitiv și cele din GitHub rămân
            neschimbate; pentru a sincroniza din nou va trebui să introduci un token.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={buttonDanger} onClick={() => void disconnectNow()}>
              Da, deconectează
            </button>
            <button
              type="button"
              className={buttonQuiet}
              onClick={() => setConfirmingDisconnect(false)}
            >
              Anulează
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
