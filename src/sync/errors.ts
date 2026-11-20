export const SYNC_ERROR_CODES = [
  /** No repository or token has been saved on this device. */
  'NOT_CONFIGURED',
  /** The token is protected by a passphrase that has not been entered since the app started. */
  'TOKEN_LOCKED',
  'BAD_PASSPHRASE',
  /** WebCrypto is missing (an insecure context): hashing and token protection need it. */
  'CRYPTO_UNAVAILABLE',
  'OFFLINE',
  /** The request could not reach GitHub although the device reports being online. */
  'NETWORK',
  /** 401: the token is wrong, expired or revoked. */
  'BAD_TOKEN',
  /** What was typed as the repository is not an `owner/name` GitHub accepts. */
  'INVALID_REPO',
  /** The repository does not exist, or the token does not include it (GitHub answers 404 for both). */
  'NO_ACCESS',
  /** The token sees the repository but is not allowed to write to it (Contents: Read and write). */
  'NO_PERMISSION',
  'REPO_NOT_PRIVATE',
  'REPO_ARCHIVED',
  /** A branch protection rule rejects direct pushes to the default branch. */
  'BRANCH_PROTECTED',
  /** The repository has no commit yet and the first one could not be created. */
  'EMPTY_REPOSITORY',
  'RATE_LIMITED',
  /** GitHub answered with a 5xx status. */
  'SERVER',
  /** The branch moved on every attempt: another device kept syncing at the same time. */
  'CONFLICT',
  /** A file of the data repository cannot be read. Nothing is written until it is fixed. */
  'REMOTE_INVALID',
  /** The data repository was written by a newer version of the app. */
  'REMOTE_NEWER',
  /** The repository holds more files than the API lists in one call. */
  'REMOTE_TOO_LARGE',
  /** The local database failed (full, blocked, closed). */
  'STORAGE',
  'CANCELLED',
  /** GitHub answered in a way this client does not understand. */
  'UNEXPECTED',
] as const;
export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];

export interface SyncErrorOptions extends ErrorOptions {
  /** HTTP status of the GitHub answer, when there was one. */
  status?: number;
  /** For `RATE_LIMITED`: when requests are allowed again. */
  retryAt?: Date;
  /** What the failure is about (a file path, GitHub's message). Never a secret. */
  detail?: string;
}

/** A failed sync step. `message` is for logs; screens map `code` to Romanian text. */
export class SyncError extends Error {
  readonly code: SyncErrorCode;
  readonly status: number | undefined;
  readonly retryAt: Date | undefined;
  readonly detail: string | undefined;

  constructor(code: SyncErrorCode, message: string, options: SyncErrorOptions = {}) {
    super(message, options);
    this.name = 'SyncError';
    this.code = code;
    this.status = options.status;
    this.retryAt = options.retryAt;
    this.detail = options.detail;
  }
}

export function isSyncError(error: unknown): error is SyncError {
  return error instanceof SyncError;
}

/** A failure as it is kept and shown, without the stack: also the shape of the stored status. */
export interface SyncFailure {
  readonly code: SyncErrorCode;
  /** A file path or GitHub's own words: never a secret. */
  readonly detail?: string;
  /** When a rate limit ends (ISO). */
  readonly retryAt?: string;
}

export function describeFailure(error: SyncError): SyncFailure {
  const retryAt =
    error.retryAt && !Number.isNaN(error.retryAt.getTime())
      ? error.retryAt.toISOString()
      : undefined;
  return {
    code: error.code,
    ...(error.detail ? { detail: error.detail } : {}),
    ...(retryAt ? { retryAt } : {}),
  };
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

/** Failures that retrying cannot fix: the user has to change the connection first. */
const BLOCKING_CODES: ReadonlySet<SyncErrorCode> = new Set([
  'NOT_CONFIGURED',
  'INVALID_REPO',
  'BAD_TOKEN',
  'NO_ACCESS',
  'NO_PERMISSION',
  'REPO_NOT_PRIVATE',
  'REPO_ARCHIVED',
  'BRANCH_PROTECTED',
  'EMPTY_REPOSITORY',
  'REMOTE_INVALID',
  'REMOTE_NEWER',
  'REMOTE_TOO_LARGE',
]);

/** Automatic sync stays quiet after these until a manual sync succeeds, instead of hammering GitHub. */
export function isBlockingCode(code: SyncErrorCode): boolean {
  return BLOCKING_CODES.has(code);
}
