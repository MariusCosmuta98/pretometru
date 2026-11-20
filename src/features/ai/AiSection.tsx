import { useId, useState, type FormEvent } from 'react';
import {
  AI_EUROPE,
  AI_FREE_TIER,
  AI_NOTICE_FOOTER,
  AI_PERSONAL_DATA,
  AI_RESPONSIBILITY,
  AI_SENT,
  AI_TERMS_URL,
  DEFAULT_MODEL,
  describeAiError,
  getAiServices,
  readAiConfig,
  removeApiKey,
  saveApiKey,
  setAiEnabled,
  setAiModel,
  testGeminiConnection,
  type AiConfig,
  type NoticeParagraph,
} from '@/ai';
import { ConfirmPanel } from '@/ui/ConfirmPanel';
import {
  buttonPrimary,
  buttonQuiet,
  buttonSecondary,
  inputClass,
  labelClass,
  noticeClass,
} from '@/ui/controls';
import { useDbQuery } from '@/ui/live';
import { Failure, Loading } from '@/ui/states';

type Message = { tone: 'success' | 'error'; text: string };

const link = 'font-medium text-teal-700 underline dark:text-teal-400';
const muted = 'text-sm text-slate-600 dark:text-slate-400';

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a className={link} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Paragraph({ title, text }: NoticeParagraph) {
  return (
    <p>
      <strong>{title}.</strong> {text}
    </p>
  );
}

/** What leaving the device means, before the switch that allows it. The review's confirmation repeats it. */
function Disclosure() {
  return (
    <div className={`${noticeClass.warning} space-y-2`}>
      <Paragraph {...AI_FREE_TIER} />
      <Paragraph {...AI_EUROPE} />
      <Paragraph {...AI_PERSONAL_DATA} />
      <Paragraph {...AI_SENT} />
      <Paragraph {...AI_RESPONSIBILITY} />
      <p>
        {AI_NOTICE_FOOTER} <ExternalLink href={AI_TERMS_URL}>Termenii Gemini API</ExternalLink>
      </p>
    </div>
  );
}

function Result({ message }: { message: Message | undefined }) {
  if (!message) return null;
  return message.tone === 'error' ? (
    <p role="alert" className={noticeClass.error}>
      {message.text}
    </p>
  ) : (
    <p role="status" className={noticeClass.success}>
      {message.text}
    </p>
  );
}

type Busy = 'save' | 'test' | 'remove';

/** The key: pasted once, kept on this device, tried against Google without sending any receipt. */
function KeyPanel({ config }: { config: AiConfig }) {
  const fieldId = useId();
  const [key, setKey] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [busy, setBusy] = useState<Busy>();
  const [message, setMessage] = useState<Message>();

  const showForm = !config.hasKey || replacing;

  async function run(what: Busy, action: () => Promise<Message | undefined>) {
    setBusy(what);
    setMessage(undefined);
    try {
      setMessage(await action());
    } catch (error) {
      setMessage({ tone: 'error', text: describeAiError(error) });
    } finally {
      setBusy(undefined);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void run('save', async () => {
      await saveApiKey(await getAiServices().getDb(), key);
      setKey('');
      setReplacing(false);
      return {
        tone: 'success',
        text: 'Cheia a fost salvată pe acest dispozitiv. Citirea cu AI rămâne oprită până o pornești mai jos.',
      };
    });
  }

  function test() {
    void run('test', async () => {
      const info = await testGeminiConnection();
      return {
        tone: 'success',
        text: `Conexiunea funcționează: modelul ${info.model} este disponibil. Nu s-a trimis niciun bon.`,
      };
    });
  }

  function remove() {
    void run('remove', async () => {
      await removeApiKey(await getAiServices().getDb());
      setConfirmingRemove(false);
      return {
        tone: 'success',
        text: 'Cheia a fost ștearsă de pe acest dispozitiv, iar citirea cu AI este oprită.',
      };
    });
  }

  return (
    <div className="space-y-3">
      {showForm ? (
        <form className="space-y-3" onSubmit={save}>
          {config.hasKey ? null : (
            <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700 dark:text-slate-300">
              <li>
                În{' '}
                <ExternalLink href="https://aistudio.google.com/apikey">
                  Google AI Studio
                </ExternalLink>{' '}
                creează o cheie API doar pentru această aplicație.
              </li>
              <li>
                Lipește-o mai jos. Rămâne doar pe acest dispozitiv: nu intră în copiile de
                siguranță, nu se sincronizează și nu apare în adrese. Dacă pierzi dispozitivul,
                șterge cheia și din Google AI Studio.
              </li>
            </ol>
          )}
          <div>
            <label htmlFor={fieldId} className={labelClass}>
              Cheie API Gemini
            </label>
            <input
              id={fieldId}
              type="password"
              className={inputClass}
              value={key}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => {
                setKey(event.target.value);
              }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className={buttonPrimary}
              disabled={busy !== undefined || key.trim() === ''}
            >
              Salvează cheia
            </button>
            {config.hasKey ? (
              <button
                type="button"
                className={buttonSecondary}
                onClick={() => {
                  setReplacing(false);
                  setKey('');
                }}
              >
                Renunță
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            Cheia este salvată pe acest dispozitiv ({config.keyHint}). Nimeni altcineva nu o vede.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonSecondary}
              disabled={busy !== undefined}
              onClick={test}
            >
              {busy === 'test' ? 'Se verifică…' : 'Testează conexiunea'}
            </button>
            <button
              type="button"
              className={buttonQuiet}
              disabled={busy !== undefined}
              onClick={() => {
                setMessage(undefined);
                setReplacing(true);
              }}
            >
              Schimbă cheia
            </button>
            <button
              type="button"
              className={buttonQuiet}
              disabled={busy !== undefined}
              onClick={() => {
                setMessage(undefined);
                setConfirmingRemove(true);
              }}
            >
              Șterge cheia
            </button>
          </div>
          <p className={muted}>
            Testul cere doar descrierea modelului: verifică cheia și numele modelului și nu trimite
            niciun bon.
          </p>
        </div>
      )}

      {confirmingRemove ? (
        <ConfirmPanel
          title="Ștergi cheia?"
          confirmLabel="Șterge cheia"
          busy={busy === 'remove'}
          onConfirm={remove}
          onCancel={() => {
            setConfirmingRemove(false);
          }}
        >
          <p className="text-sm">
            Cheia dispare de pe acest dispozitiv și citirea cu AI se oprește. La Google cheia rămâne
            valabilă până o ștergi și acolo.
          </p>
        </ConfirmPanel>
      ) : null}

      <Result message={message} />
    </div>
  );
}

/** The switch that allows the "Citește cu AI" action in the review. Off by default; needs a key. */
function EnableSwitch({ config }: { config: AiConfig }) {
  const id = useId();
  const [error, setError] = useState<string>();
  // What was just chosen shows at once; it is dropped when the stored state has caught up with it.
  const [pending, setPending] = useState<boolean>();
  if (pending !== undefined && pending === config.enabled) setPending(undefined);

  async function toggle(enabled: boolean) {
    setError(undefined);
    setPending(enabled);
    try {
      await setAiEnabled(await getAiServices().getDb(), enabled);
    } catch (failure) {
      setPending(undefined);
      setError(describeAiError(failure));
    }
  }

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex min-h-11 items-center gap-3 text-sm font-medium">
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="size-5 accent-teal-700"
          checked={pending ?? config.enabled}
          disabled={!config.hasKey}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            void toggle(event.target.checked);
          }}
        />
        Pornește citirea cu AI (Gemini)
      </label>
      <p id={`${id}-hint`} className={muted}>
        {config.hasKey
          ? 'Când este pornită, ecranul de verificare al unui bon importat din poză are butonul „Citește cu AI”. Nimic nu se trimite până apeși butonul și confirmi.'
          : 'Salvează mai întâi o cheie.'}
      </p>
      {error ? (
        <p role="alert" className={noticeClass.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The model id: a default that works, a field for the day Google retires it. */
function ModelPanel({ config }: { config: AiConfig }) {
  const id = useId();
  const [model, setModel] = useState(config.model);
  const [message, setMessage] = useState<Message>();

  async function save(value: string) {
    setMessage(undefined);
    try {
      await setAiModel(await getAiServices().getDb(), value);
      setMessage({ tone: 'success', text: 'Modelul a fost salvat.' });
    } catch (error) {
      setMessage({ tone: 'error', text: describeAiError(error) });
    }
  }

  return (
    <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <summary className="cursor-pointer text-sm font-medium">Setări avansate</summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save(model);
        }}
      >
        <div>
          <label htmlFor={id} className={labelClass}>
            Model Gemini
          </label>
          <input
            id={id}
            type="text"
            className={inputClass}
            value={model}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-describedby={`${id}-hint`}
            onChange={(event) => {
              setModel(event.target.value);
            }}
          />
          <p id={`${id}-hint`} className={`mt-1 ${muted}`}>
            Implicit: {DEFAULT_MODEL} (stabil, cu nivel gratuit). Numele modelelor se schimbă; dacă
            primești „modelul nu există”, alege un nume din{' '}
            <ExternalLink href="https://ai.google.dev/gemini-api/docs/models">
              lista Google
            </ExternalLink>
            . Pentru poze greu de citit poți încerca un model mai puternic, de exemplu
            gemini-3.6-flash.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={buttonSecondary}>
            Salvează modelul
          </button>
          <button
            type="button"
            className={buttonQuiet}
            onClick={() => {
              setModel(DEFAULT_MODEL);
              void save('');
            }}
          >
            Folosește modelul implicit
          </button>
        </div>
        <Result message={message} />
      </form>
    </details>
  );
}

/** The "Gemini (opțional)" card of the Settings screen. Nothing here sends anything by itself. */
export default function AiSection() {
  const config = useDbQuery(readAiConfig);

  if (config.status === 'loading') return <Loading what="setările" />;
  if (config.status === 'error') {
    return (
      <Failure>
        Setările nu sunt disponibile: baza de date de pe acest dispozitiv nu poate fi deschisă.
      </Failure>
    );
  }

  return (
    <div className="space-y-4">
      <p className={muted}>
        Citirea cu AI este opțională și oprită implicit. Dacă o pornești, pe ecranul unui bon
        importat din poză apare butonul „Citește cu AI”: poza este trimisă la Gemini (Google), cu
        propria ta cheie, doar când apeși butonul și confirmi. Importul din PDF, din poză (OCR) și
        din text lipit nu se schimbă și nu trimite nimic nicăieri.
      </p>
      <Disclosure />
      <KeyPanel config={config.value} />
      <EnableSwitch config={config.value} />
      <ModelPanel config={config.value} />
    </div>
  );
}
