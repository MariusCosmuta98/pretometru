const decimal = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 1 });

/** `1,3 MB`: what a file weighs, for a person. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${decimal.format(bytes / 1024 ** 3)} GB`;
  if (bytes >= 1024 ** 2) return `${decimal.format(bytes / 1024 ** 2)} MB`;
  return `${decimal.format(Math.max(bytes, 0) / 1024)} KB`;
}

const when = new Intl.DateTimeFormat('ro-RO', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** `20 noiembrie 2026, 15:42` in the device's time zone. */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : when.format(date);
}
