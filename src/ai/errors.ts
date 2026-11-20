export const AI_ERROR_CODES = [
  /** The feature is switched off: nothing is sent. */
  'NOT_ENABLED',
  /** Switched on (or being switched on) without a saved key. */
  'NO_KEY',
  /** What was typed as the key cannot be one (spaces, odd characters, too short). */
  'INVALID_KEY',
  /** What was typed as the model id cannot be put in an address. */
  'INVALID_MODEL',
  /** The photo cannot be decoded, resized or re-encoded here: nothing was sent. */
  'IMAGE_UNREADABLE',
  'OFFLINE',
  /** The request could not reach Google although the device reports being online. */
  'NETWORK',
  'TIMEOUT',
  /** 400 `API_KEY_INVALID` or 401: the key is wrong, deleted or expired. */
  'BAD_KEY',
  /** 403: the key is restricted, the API is not enabled for it, or the project needs verification. */
  'FORBIDDEN',
  /** 404: the model id does not exist (any more). */
  'MODEL_NOT_FOUND',
  /** The model exists but cannot generate content (an embedding model, for example). */
  'MODEL_UNSUPPORTED',
  /** 400 `FAILED_PRECONDITION`: the free tier is not available for this account, country or project. */
  'REGION',
  /** 429: the daily quota is used up. */
  'QUOTA',
  /** 429: too many requests (or tokens) in a minute. */
  'RATE_LIMITED',
  /** 5xx: Google is overloaded or down. */
  'SERVER',
  /** Another 4xx: Google refused the request itself. */
  'REJECTED',
  /** Google's filters blocked the prompt or the answer. */
  'BLOCKED',
  /** The answer ran into the output limit before it was complete. */
  'TRUNCATED',
  /** No candidate, or no text in it. */
  'EMPTY_ANSWER',
  /** The answer is not JSON of the shape that was asked for. */
  'MALFORMED',
  /** A well-formed answer that found no usable line on the photo. */
  'NO_LINES',
  'CANCELLED',
  'UNEXPECTED',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export interface AiErrorOptions extends ErrorOptions {
  /** HTTP status of Google's answer, when there was one. */
  status?: number;
  /** For `RATE_LIMITED` and `QUOTA`: how long Google asks to wait (from `RetryInfo`). */
  retryAfterSeconds?: number;
  /** What the failure is about (Google's own words, the finish reason). Never a secret. */
  detail?: string;
}

/** A failed AI step. `message` is for logs; screens map `code` to Romanian text (`describeAiError`). */
export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly detail: string | undefined;

  constructor(code: AiErrorCode, message: string, options: AiErrorOptions = {}) {
    super(message, options);
    this.name = 'AiError';
    this.code = code;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.detail = options.detail;
  }
}

export function isAiError(error: unknown): error is AiError {
  return error instanceof AiError;
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}
