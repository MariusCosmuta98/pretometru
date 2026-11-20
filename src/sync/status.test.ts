import { describe, expect, it } from 'vitest';
import type { SyncAttempt } from './runtime';
import { currentFailure, type SyncStatus } from './status';

const EARLIER = '2026-11-20T10:00:00.000Z';
const LATER = '2026-11-20T11:00:00.000Z';

const succeeded = (at: string): SyncStatus => ({
  at,
  ok: true,
  success: { at, pulled: 0, pushed: 0, firstSync: false },
});
const failed = (at: string): SyncStatus => ({
  at,
  ok: false,
  error: { code: 'OFFLINE' },
  success: { at: EARLIER, pulled: 0, pushed: 0, firstSync: false },
});
const attempt = (at: string, failure?: 'BAD_TOKEN'): SyncAttempt => ({
  at,
  failure: failure ? { code: failure } : undefined,
});

describe('currentFailure', () => {
  it('is what the stored status says when this session has not synced', () => {
    expect(currentFailure(failed(EARLIER), undefined)).toEqual({ code: 'OFFLINE' });
    expect(currentFailure(succeeded(EARLIER), undefined)).toBeUndefined();
    expect(currentFailure(undefined, undefined)).toBeUndefined();
  });

  it('is what the last sync of this session says, which the stored status only follows', () => {
    expect(currentFailure(succeeded(EARLIER), attempt(LATER, 'BAD_TOKEN'))).toEqual({
      code: 'BAD_TOKEN',
    });
    expect(currentFailure(undefined, attempt(LATER, 'BAD_TOKEN'))).toEqual({ code: 'BAD_TOKEN' });
    // A success ends a failure that the stored status still has.
    expect(currentFailure(failed(EARLIER), attempt(LATER))).toBeUndefined();
  });

  it('goes with this session when both are from the same moment: it is the same sync', () => {
    expect(currentFailure(succeeded(LATER), attempt(LATER, 'BAD_TOKEN'))).toEqual({
      code: 'BAD_TOKEN',
    });
    expect(currentFailure(failed(LATER), attempt(LATER))).toBeUndefined();
  });

  it('goes with the stored status when it is newer: something else synced since', () => {
    expect(currentFailure(failed(LATER), attempt(EARLIER))).toEqual({ code: 'OFFLINE' });
    expect(currentFailure(succeeded(LATER), attempt(EARLIER, 'BAD_TOKEN'))).toBeUndefined();
  });
});
