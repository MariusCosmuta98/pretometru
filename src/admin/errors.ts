export const ADMIN_ERROR_CODES = [
  /** A name that is empty once tidied. */
  'EMPTY_NAME',
  /** Another live category already has this name. */
  'DUPLICATE_NAME',
  /** The icon is not a single emoji. */
  'INVALID_ICON',
  /** The colour is not `#rrggbb`. */
  'INVALID_COLOR',
  /** The category or store does not exist (any more). */
  'NOT_FOUND',
  /** "Non-produs" cannot be renamed, moved or deleted. */
  'SYSTEM_CATEGORY',
  /** Products or lines use the category, so a category to move them to is mandatory. */
  'TARGET_REQUIRED',
  /** The category to move to is missing, deleted, the system one, or the deleted category itself. */
  'INVALID_TARGET',
  /** A store cannot be merged into itself. */
  'SAME_STORE',
  /** A store with receipts cannot be deleted: merge it into another one. */
  'HAS_RECEIPTS',
] as const;
export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[number];

/** A refused category or store operation. `message` is for logs; screens map `code` to Romanian text. */
export class AdminError extends Error {
  readonly code: AdminErrorCode;

  constructor(code: AdminErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AdminError';
    this.code = code;
  }
}

export function isAdminError(error: unknown): error is AdminError {
  return error instanceof AdminError;
}
