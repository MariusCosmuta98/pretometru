// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToday } from './useToday';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-11-30T20:00:00Z')); // 22:00 in Bucharest
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useToday', () => {
  it('is the day in Europe/Bucharest, not in UTC', () => {
    expect(renderHook(() => useToday()).result.current).toBe('2026-11-30');

    vi.setSystemTime(new Date('2026-11-30T22:30:00Z')); // 00:30 on 1 December in Bucharest
    expect(renderHook(() => useToday()).result.current).toBe('2026-12-01');
  });

  it('moves on by itself while the app stays open', () => {
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-11-30');

    act(() => {
      vi.setSystemTime(new Date('2026-11-30T22:30:00Z'));
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current).toBe('2026-12-01');
  });

  it('is read again when the app comes back to the foreground', () => {
    const { result } = renderHook(() => useToday());

    act(() => {
      vi.setSystemTime(new Date('2026-12-05T08:00:00Z'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe('2026-12-05');

    act(() => {
      vi.setSystemTime(new Date('2026-12-06T08:00:00Z'));
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current).toBe('2026-12-06');
  });

  it('stops watching when the screen goes away', () => {
    const { result, unmount } = renderHook(() => useToday());
    unmount();

    vi.setSystemTime(new Date('2026-12-05T08:00:00Z'));
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(120_000);

    expect(result.current).toBe('2026-11-30');
    expect(vi.getTimerCount()).toBe(0);
  });
});
