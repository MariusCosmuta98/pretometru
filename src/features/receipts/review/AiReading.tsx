import { useEffect, useId, useRef, useState } from 'react';
import { AI_CONFIRMATION, AI_NOTICE_FOOTER, AI_TERMS_URL, describeAiError, isAiError } from '@/ai';
import type { ExtractionEngine } from '@/domain';
import type { AiReadPhase } from '@/import';
import { buttonPrimary, buttonSecondary, card, noticeClass } from '@/ui/controls';
import { Dialog } from './Dialog';

type Step = 'idle' | 'confirm' | 'reading';
type Message = { tone: 'success' | 'info' | 'error'; text: string };

export interface AiReadingProps {
  /** The optional Gemini reading is switched on and this is a draft read from a photo. */
  available: boolean;
  /** The photo, still in memory when the receipt was imported in this session. */
  original: Blob | undefined;
  /** Which reading is on screen. For `gemini`, `parser` is the model that answered. */
  shown: { engine: ExtractionEngine; parser: string };
  /** A reading that was replaced is still there to look at. */
  hasAlternate: boolean;
  /** Something else (a save, a delete) is under way. */
  disabled: boolean;
  /**
   * Sends the photo and puts the reading in the place of the one on screen. Called only after the
   * user confirmed; rejects when the reading failed, and then nothing has changed.
   */
  onRead: (
    photo: Blob,
    run: { signal: AbortSignal; onPhase: (phase: AiReadPhase) => void },
  ) => Promise<void>;
  onSwap: () => void;
}

const PHASE_TEXT: Record<AiReadPhase, string> = {
  preparing: 'Pregătesc poza…',
  sending: 'Gemini citește bonul… Poate dura câteva zeci de secunde.',
};

/**
 * "Citește cu AI" in the review: reads the photo of a receipt with Gemini, only after the user was
 * told what is sent and confirmed. The reading takes the place of the one on screen like any edit
 * (nothing is saved, the warnings are recomputed), and the one it replaced stays one button away.
 */
export function AiReading({
  available,
  original,
  shown,
  hasAlternate,
  disabled,
  onRead,
  onSwap,
}: AiReadingProps) {
  const headingId = useId();
  const pickerId = useId();
  const [step, setStep] = useState<Step>('idle');
  const [phase, setPhase] = useState<AiReadPhase>('preparing');
  const [picked, setPicked] = useState<File>();
  const [message, setMessage] = useState<Message>();
  const abort = useRef<AbortController>(undefined);

  // Leaving the screen ends a reading that is still under way.
  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );

  const gemini = shown.engine === 'gemini';
  const canRead = available && (!gemini || !hasAlternate);
  if (!canRead && !gemini && !hasAlternate) return null;

  const photo = original ?? picked;

  async function send() {
    if (!photo) return;
    const controller = new AbortController();
    abort.current = controller;
    setPhase('preparing');
    setMessage(undefined);
    setStep('reading');
    try {
      await onRead(photo, { signal: controller.signal, onPhase: setPhase });
      setPicked(undefined);
      setMessage({
        tone: 'success',
        text: 'Gemini a citit bonul. Verifică liniile și suma cu poza înainte să confirmi.',
      });
    } catch (error) {
      setMessage({
        tone: isAiError(error) && error.code === 'CANCELLED' ? 'info' : 'error',
        text: describeAiError(error),
      });
    } finally {
      abort.current = undefined;
      setStep('idle');
    }
  }

  const tone = { success: noticeClass.success, info: noticeClass.info, error: noticeClass.error };

  return (
    <section aria-labelledby={headingId} className={`${card} space-y-3`}>
      <h2 id={headingId} className="font-semibold">
        Citire cu AI
      </h2>

      {gemini ? (
        <p className={noticeClass.info}>
          Bonul este citit cu Gemini ({shown.parser}). Compară produsele și sumele cu poza înainte
          să confirmi.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canRead ? (
          <button
            type="button"
            className={buttonSecondary}
            disabled={disabled || step !== 'idle'}
            onClick={() => {
              setMessage(undefined);
              setStep('confirm');
            }}
          >
            Citește cu AI
          </button>
        ) : null}
        {hasAlternate ? (
          <button
            type="button"
            className={buttonSecondary}
            disabled={step === 'reading'}
            onClick={onSwap}
          >
            {gemini ? 'Arată citirea anterioară' : 'Arată citirea Gemini'}
          </button>
        ) : null}
      </div>
      {canRead && !gemini ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Poza poate fi citită și de Gemini (Google), cu cheia ta. Pleacă de pe dispozitiv doar după
          ce confirmi.
        </p>
      ) : null}

      {step === 'reading' ? (
        <div className="space-y-2">
          <p role="status" className={noticeClass.info}>
            {PHASE_TEXT[phase]}
          </p>
          <button
            type="button"
            className={buttonSecondary}
            onClick={() => {
              abort.current?.abort();
            }}
          >
            Anulează citirea
          </button>
        </div>
      ) : null}

      {message ? (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={tone[message.tone]}>
          {message.text}
        </p>
      ) : null}

      {step === 'confirm' ? (
        <Dialog
          title="Trimiți poza la Gemini?"
          onClose={() => {
            setStep('idle');
          }}
        >
          <div className="space-y-2 text-sm">
            {AI_CONFIRMATION.map((paragraph) => (
              <p key={paragraph.title}>
                <strong>{paragraph.title}.</strong> {paragraph.text}
              </p>
            ))}
            <p className="text-slate-600 dark:text-slate-400">
              {AI_NOTICE_FOOTER}{' '}
              <a
                className="font-medium text-teal-700 underline dark:text-teal-400"
                href={AI_TERMS_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Termenii Gemini API
              </a>
            </p>
          </div>

          {original ? null : (
            <div className="space-y-1">
              <label htmlFor={pickerId} className="block text-sm font-medium">
                Poza bonului
              </label>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Poza originală nu mai este în memorie (aplicația a fost reîncărcată după import).
                Alege din nou poza bonului.
              </p>
              <input
                id={pickerId}
                type="file"
                accept="image/*"
                className="block w-full text-sm"
                onChange={(event) => {
                  setPicked(event.target.files?.[0]);
                }}
              />
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              data-autofocus
              className={buttonSecondary}
              onClick={() => {
                setStep('idle');
              }}
            >
              Renunță
            </button>
            <button
              type="button"
              className={buttonPrimary}
              disabled={photo === undefined}
              onClick={() => {
                void send();
              }}
            >
              Trimite poza la Gemini
            </button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
