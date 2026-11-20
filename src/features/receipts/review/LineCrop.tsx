import { useEffect, useRef, useState } from 'react';
import { getImportServices, type LineBox } from '@/import';

interface LineCropProps {
  /** The picked photo, kept in memory for as long as the receipt is under review. */
  original: Blob;
  bbox: LineBox;
  /** Alternative text: what the crop shows. */
  label: string;
}

/**
 * The part of the original image a line was read from, so the user can compare it with the
 * parsed values. The crop is cut only when the card scrolls into view (a long receipt would
 * otherwise decode the photo once per line), and its object URL is released on unmount.
 */
export function LineCrop({ original, bbox, label }: LineCropProps) {
  const holder = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const [crop, setCrop] = useState<{ url?: string; failed?: boolean }>({});
  const { x, y, w, h, page } = bbox;

  useEffect(() => {
    const node = holder.current;
    if (visible || !node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    getImportServices()
      .engines.cropRegion(original, { x, y, w, h }, { padding: 8 })
      .then(
        (blob) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setCrop({ url: objectUrl });
        },
        () => {
          if (!cancelled) setCrop({ failed: true });
        },
      );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [visible, original, x, y, w, h, page]);

  if (crop.failed) return null;
  return (
    <figure
      ref={holder}
      className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800"
    >
      {crop.url ? (
        <img src={crop.url} alt={label} className="max-h-28 w-full object-contain" />
      ) : (
        <div className="h-12 animate-pulse" role="img" aria-label="Se pregătește decupajul…" />
      )}
    </figure>
  );
}
