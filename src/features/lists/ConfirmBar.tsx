import { useEffect, useId, useRef } from 'react';
import { buttonDanger, buttonSecondary, noticeClass } from '@/ui/controls';

/**
 * An inline question before something that cannot be undone. Focus lands on "Anulează" (the safe
 * answer, which a screen reader reads together with the question) and Escape cancels.
 */
export function ConfirmBar({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const messageId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
  }, []);

  return (
    <div
      role="group"
      aria-labelledby={messageId}
      className={`${noticeClass.warning} space-y-2`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <p id={messageId}>{message}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonDanger} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" ref={cancel} className={buttonSecondary} onClick={onCancel}>
          Anulează
        </button>
      </div>
    </div>
  );
}
