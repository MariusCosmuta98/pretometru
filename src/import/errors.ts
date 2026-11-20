export const IMPORT_ERROR_CODES = [
  /** Not a PDF, an image or text. */
  'UNSUPPORTED_FORMAT',
  'EMPTY_INPUT',
  'FILE_TOO_LARGE',
  /** A PDF without a text layer, or an image the OCR found no text in. */
  'NO_TEXT',
  /** The text was read but no parser found a single line in it. */
  'NOTHING_RECOGNIZED',
  /** The engine or parser module is not wired in (yet). */
  'ENGINE_UNAVAILABLE',
  'EXTRACTION_FAILED',
  'SAVE_FAILED',
  'CANCELLED',
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

/** Failure of the import pipeline. `message` is for logs; screens map `code` to Romanian text. */
export class ImportError extends Error {
  readonly code: ImportErrorCode;

  constructor(code: ImportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ImportError';
    this.code = code;
  }
}

export function isImportError(error: unknown): error is ImportError {
  return error instanceof ImportError;
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

/** Throws `CANCELLED` once the caller aborted. */
export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ImportError('CANCELLED', 'The import was cancelled');
}
