import { useId, useState, type FormEvent } from 'react';
import {
  getSyncServices,
  isPlausibleRepoInput,
  runSync,
  saveConnection,
  verifyConnection,
  type ConnectionCheck,
  type VerifyStep,
} from '@/sync';
import { buttonPrimary, buttonQuiet, inputClass, labelClass, noticeClass } from '@/ui/controls';
import {
  errorMessage,
  ERROR_MESSAGES,
  remoteSummaryText,
  STEP_LABELS,
  STEPS,
  toFailure,
  type Failure,
} from './messages';

const MIN_PASSPHRASE = 8;

type Phase =
  | { kind: 'idle' }
  | { kind: 'invalid'; message: string }
  | { kind: 'checking'; passed: VerifyStep[] }
  | { kind: 'failed'; passed: VerifyStep[]; failure: Failure }
  | { kind: 'ready'; passed: VerifyStep[]; check: ConnectionCheck }
  | { kind: 'saving' };

interface Props {
  /** `connect`: first setup, with the instructions. `update`: a new token or another repository. */
  mode: 'connect' | 'update';
  repoDefault?: string;
  onCancel?: () => void;
  /** The connection was saved and the sync has started. In `connect` mode the section switches views by itself. */
  onSaved?: () => void;
}

function Checklist({ passed, failed }: { passed: readonly VerifyStep[]; failed: boolean }) {
  // The check that failed is the one after the last that passed.
  const shown = failed ? STEPS.slice(0, passed.length + 1) : passed;
  return (
    <ul className="space-y-1 text-sm" aria-label="Verificări">
      {shown.map((step, index) => {
        const ok = index < passed.length;
        return (
          <li key={step} className="flex gap-2">
            <span aria-hidden="true">{ok ? '✓' : '✗'}</span>
            <span className="sr-only">{ok ? 'Reușit: ' : 'Eșuat: '}</span>
            {STEP_LABELS[step]}
          </li>
        );
      })}
    </ul>
  );
}

function Instructions() {
  const link = 'font-medium text-teal-700 underline dark:text-teal-400';
  return (
    <>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Păstrează o copie a datelor tale într-un depozit GitHub <strong>privat</strong>, al tău, și
        sincronizează-le între dispozitive. Istoricul Git al depozitului este backup-ul tău: fiecare
        sincronizare este un commit. Nu costă nimic.
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700 dark:text-slate-300">
        <li>
          Creează pe GitHub un depozit <strong>privat</strong> numit <code>pretometru-data</code> (
          <a
            className={link}
            href="https://github.com/new"
            target="_blank"
            rel="noopener noreferrer"
          >
            github.com/new
          </a>
          ). Alege <em>Private</em> și bifează <em>Add a README file</em>.
        </li>
        <li>
          Creează un token <em>fine-grained</em> (
          <a
            className={link}
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noopener noreferrer"
          >
            Settings → Developer settings → Fine-grained tokens
          </a>
          ). La <em>Repository access</em> alege <em>Only select repositories</em> și doar{' '}
          <code>pretometru-data</code>; la <em>Repository permissions</em> pune <em>Contents</em> pe{' '}
          <em>Read and write</em>. Altă permisiune nu este nevoie.
        </li>
        <li>Lipește tokenul mai jos. Rămâne doar pe acest dispozitiv.</li>
      </ol>
    </>
  );
}

export function ConnectForm({ mode, repoDefault = 'pretometru-data', onCancel, onSaved }: Props) {
  const ids = {
    token: useId(),
    repo: useId(),
    repoHelp: useId(),
    protect: useId(),
    passphrase: useId(),
    again: useId(),
    passphraseHelp: useId(),
  };
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState(repoDefault);
  const [protect, setProtect] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const busy = phase.kind === 'checking' || phase.kind === 'saving';
  // Editing a field after a check makes the check stale: start over.
  const edited =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      if (phase.kind === 'ready' || phase.kind === 'failed' || phase.kind === 'invalid') {
        setPhase({ kind: 'idle' });
      }
    };

  function problem(): string | undefined {
    if (!token.trim()) return 'Lipește tokenul GitHub.';
    if (!repo.trim()) return 'Scrie numele depozitului.';
    if (!isPlausibleRepoInput(repo)) return ERROR_MESSAGES.INVALID_REPO;
    if (protect && passphrase.length < MIN_PASSPHRASE) {
      return `Parola trebuie să aibă cel puțin ${MIN_PASSPHRASE} caractere.`;
    }
    if (protect && passphrase !== again) return 'Parolele nu se potrivesc.';
    return undefined;
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    const message = problem();
    if (message) {
      setPhase({ kind: 'invalid', message });
      return;
    }
    const passed: VerifyStep[] = [];
    setPhase({ kind: 'checking', passed });
    try {
      const check = await verifyConnection({ token, repo }, getSyncServices(), (step) => {
        passed.push(step);
        setPhase({ kind: 'checking', passed: [...passed] });
      });
      setPhase({ kind: 'ready', passed: [...passed], check });
    } catch (error) {
      setPhase({ kind: 'failed', passed: [...passed], failure: toFailure(error) });
    }
  }

  async function connect(check: ConnectionCheck, passed: VerifyStep[]) {
    setPhase({ kind: 'saving' });
    try {
      const services = getSyncServices();
      await saveConnection(
        await services.getDb(),
        {
          owner: check.owner,
          repo: check.repo,
          token: token.trim(),
          passphrase: protect ? passphrase : undefined,
        },
        services,
      );
    } catch (error) {
      setPhase({ kind: 'failed', passed, failure: toFailure(error) });
      return;
    }
    // The section switches to the connected view as soon as the connection is saved; the outcome
    // of the first sync is what that view shows. A form that is already inside it closes itself.
    onSaved?.();
    void runSync().catch(() => undefined);
  }

  return (
    <form onSubmit={(event) => void verify(event)} className="space-y-4" noValidate>
      {mode === 'connect' ? <Instructions /> : null}

      <div>
        <label htmlFor={ids.token} className={labelClass}>
          Token GitHub
        </label>
        <input
          id={ids.token}
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className={inputClass}
          value={token}
          disabled={busy}
          onChange={(event) => edited(setToken)(event.target.value)}
        />
      </div>

      <div>
        <label htmlFor={ids.repo} className={labelClass}>
          Depozit
        </label>
        <input
          id={ids.repo}
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className={inputClass}
          value={repo}
          disabled={busy}
          aria-describedby={ids.repoHelp}
          onChange={(event) => edited(setRepo)(event.target.value)}
        />
        <p id={ids.repoHelp} className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Numele depozitului tău sau <code>proprietar/depozit</code>. Trebuie să fie privat.
        </p>
      </div>

      <div>
        <div className="flex min-h-11 items-center gap-2">
          <input
            id={ids.protect}
            type="checkbox"
            className="size-5 accent-teal-700"
            checked={protect}
            disabled={busy}
            onChange={(event) => edited(setProtect)(event.target.checked)}
          />
          <label htmlFor={ids.protect} className="text-sm">
            Protejează tokenul cu o parolă (opțional)
          </label>
        </div>
        {protect ? (
          <div className="mt-2 space-y-3">
            <div>
              <label htmlFor={ids.passphrase} className={labelClass}>
                Parolă
              </label>
              <input
                id={ids.passphrase}
                type="password"
                autoComplete="new-password"
                className={inputClass}
                value={passphrase}
                disabled={busy}
                aria-describedby={ids.passphraseHelp}
                onChange={(event) => edited(setPassphrase)(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor={ids.again} className={labelClass}>
                Repetă parola
              </label>
              <input
                id={ids.again}
                type="password"
                autoComplete="new-password"
                className={inputClass}
                value={again}
                disabled={busy}
                onChange={(event) => edited(setAgain)(event.target.value)}
              />
            </div>
            <p id={ids.passphraseHelp} className="text-xs text-slate-500 dark:text-slate-400">
              Tokenul se păstrează criptat pe acest dispozitiv, iar aplicația cere parola o dată la
              fiecare pornire. Parola nu poate fi recuperată: dacă o uiți, creezi din nou tokenul.
            </p>
          </div>
        ) : null}
      </div>

      {phase.kind === 'invalid' ? (
        <p role="alert" className={noticeClass.error}>
          {phase.message}
        </p>
      ) : null}

      {phase.kind === 'checking' ? (
        <div role="status" className="space-y-2">
          <p className="text-sm">Se verifică conexiunea…</p>
          <Checklist passed={phase.passed} failed={false} />
        </div>
      ) : null}

      {phase.kind === 'failed' ? (
        <div className="space-y-2">
          <Checklist passed={phase.passed} failed />
          <p role="alert" className={noticeClass.error}>
            {errorMessage(phase.failure.code, phase.failure.retryAt)}
            {phase.failure.code === 'REMOTE_INVALID' && phase.failure.detail ? (
              <>
                {' '}
                Fișier: <code>{phase.failure.detail}</code>
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      {phase.kind === 'ready' ? (
        <div className="space-y-3">
          <Checklist passed={phase.passed} failed={false} />
          <p role="status" className={noticeClass.info}>
            {remoteSummaryText(phase.check.remote)}
          </p>
          {phase.check.tokenKind === 'classic' ? (
            <p className={noticeClass.warning}>
              Ai folosit un token clasic: are acces la toate depozitele tale. Recomandat este un
              token <em>fine-grained</em>, limitat la <code>pretometru-data</code>.
            </p>
          ) : null}
          <button
            type="button"
            className={buttonPrimary}
            onClick={() => void connect(phase.check, phase.passed)}
          >
            {mode === 'update'
              ? 'Salvează și sincronizează'
              : phase.check.remote.state === 'new'
                ? 'Conectează și încarcă datele'
                : 'Conectează și îmbină datele'}
          </button>
        </div>
      ) : null}

      {phase.kind === 'saving' ? (
        <p role="status" className="text-sm">
          Se conectează…
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {phase.kind !== 'ready' ? (
          <button type="submit" className={buttonPrimary} disabled={busy}>
            Verifică conexiunea
          </button>
        ) : null}
        {onCancel ? (
          <button type="button" className={buttonQuiet} disabled={busy} onClick={onCancel}>
            Anulează
          </button>
        ) : null}
      </div>
    </form>
  );
}
