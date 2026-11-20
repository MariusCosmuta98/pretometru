const decimal = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 1 });

/** `1,3 MB`: what a download or the stored data weighs, for a person. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${decimal.format(bytes / 1024 ** 3)} GB`;
  if (bytes >= 1024 ** 2) return `${decimal.format(bytes / 1024 ** 2)} MB`;
  return `${decimal.format(Math.max(bytes, 0) / 1024)} KB`;
}
