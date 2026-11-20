import { useEffect, useId, useRef, type ReactNode } from 'react';
import { buttonDanger, buttonSecondary, noticeClass } from './controls';

/**
 * An inline question before something that cannot be undone, with room for the choice it needs
 * (a category to move to, the store to keep). The group is named by `title`. Focus lands on the
 * first element marked `data-autofocus` inside `children`, else on "Anulează" (the safe answer);
 * Escape cancels. The confirm button stays disabled until `canConfirm`.
 */
export function ConfirmPanel({
  title,
  children,
  confirmLabel,
  canConfirm = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  canConfirm?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    (panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? cancel.current)?.focus();
  }, []);

  return (
    <div
      ref={panel}
      role="group"
      aria-labelledby={titleId}
      className={`${noticeClass.warning} space-y-3`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onCancel();
      }}
    >
      <p id={titleId} className="font-medium">
        {title}
      </p>
      {children}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonDanger}
          disabled={!canConfirm || busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          ref={cancel}
          className={buttonSecondary}
          disabled={busy}
          onClick={onCancel}
        >
          Anulează
        </button>
      </div>
    </div>
  );
}
