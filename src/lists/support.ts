import type { StorageContext } from '@/storage';

/**
 * Fixes one instant for a whole operation, so that `checkedAt`, `archivedAt` and the `updatedAt`
 * the storage helpers stamp on the same write are the same string.
 */
export function pinClock(context?: StorageContext): { stamp: string; context: StorageContext } {
  const stamp = (context?.now?.() ?? new Date()).toISOString();
  return { stamp, context: { ...context, now: () => new Date(stamp) } };
}

/** Text as typed by a user: trimmed, runs of whitespace collapsed to one space. */
export const tidy = (text: string): string => text.trim().replace(/\s+/g, ' ');
