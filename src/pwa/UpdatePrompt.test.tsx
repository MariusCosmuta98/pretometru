// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFLINE_NOTICE_MS, UpdatePrompt } from './UpdatePrompt';

// `virtual:pwa-register/react` exists only in a real build (src/pwa/register.ts is the seam). The fake has
// the same shape (a [value, setter] pair per flag) and is driven by the tests like the service worker would
// drive it.
const registration = vi.hoisted(() => {
  let flags = { needRefresh: false, offlineReady: false };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<typeof flags>) => {
    flags = { ...flags, ...patch };
    for (const listener of listeners) listener();
  };
  return {
    set,
    reset: () => {
      flags = { needRefresh: false, offlineReady: false };
    },
    snapshot: () => flags,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setNeedRefresh: (value: boolean) => {
      set({ needRefresh: value });
    },
    setOfflineReady: (value: boolean) => {
      set({ offlineReady: value });
    },
    updateServiceWorker: vi.fn((_reloadPage?: boolean) => Promise.resolve()),
  };
});

vi.mock('./register', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useRegisterSW: () => {
      const flags = useSyncExternalStore(registration.subscribe, registration.snapshot);
      return {
        needRefresh: [flags.needRefresh, registration.setNeedRefresh],
        offlineReady: [flags.offlineReady, registration.setOfflineReady],
        updateServiceWorker: registration.updateServiceWorker,
      };
    },
  };
});

const HOUR = 60 * 60 * 1000;
const NOTICE = 'Aplicația poate fi folosită și fără internet.';
const PROMPT = 'Este disponibilă o versiune nouă a aplicației.';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  registration.reset();
  registration.updateServiceWorker.mockClear();
});

describe('the "works offline" notice (information only)', () => {
  it('says so in a status region and offers nothing to press', () => {
    registration.set({ offlineReady: true });
    render(<UpdatePrompt />);

    expect(screen.getByRole('status').textContent).toBe(NOTICE);
    // A notice with a button has to be tapped away before the page under it can be used.
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('goes away by itself, so it cannot stay over the page', () => {
    registration.set({ offlineReady: true });
    render(<UpdatePrompt />);

    act(() => {
      vi.advanceTimersByTime(OFFLINE_NOTICE_MS - 1);
    });
    expect(screen.queryByText(NOTICE)).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it.each([
    ['a tap or click', () => fireEvent.pointerDown(document.body)],
    ['a key press', () => fireEvent.keyDown(document.body, { key: 'Tab' })],
  ])('goes away as soon as the user starts using the page: %s', (_input, use) => {
    registration.set({ offlineReady: true });
    render(<UpdatePrompt />);

    use();

    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('is shown once: it does not come back after it went away', () => {
    registration.set({ offlineReady: true });
    const { rerender } = render(<UpdatePrompt />);

    fireEvent.pointerDown(document.body);
    rerender(<UpdatePrompt />);
    act(() => {
      vi.advanceTimersByTime(HOUR);
    });

    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('the new-version prompt (the user decides)', () => {
  it('waits for the user however long it takes, and never updates by itself', () => {
    registration.set({ needRefresh: true });
    render(<UpdatePrompt />);

    act(() => {
      vi.advanceTimersByTime(HOUR);
    });
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(screen.getByText(PROMPT)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Actualizează' })).toBeTruthy();
    expect(registration.updateServiceWorker).not.toHaveBeenCalled();
  });

  it('updates, and reloads into the new version, only when asked to', () => {
    registration.set({ needRefresh: true });
    render(<UpdatePrompt />);

    fireEvent.click(screen.getByRole('button', { name: 'Actualizează' }));

    expect(registration.updateServiceWorker).toHaveBeenCalledTimes(1);
    expect(registration.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('can be put off with "Închide", which activates nothing', () => {
    registration.set({ needRefresh: true });
    render(<UpdatePrompt />);

    fireEvent.click(screen.getByRole('button', { name: 'Închide' }));

    expect(screen.queryByRole('status')).toBeNull();
    expect(registration.updateServiceWorker).not.toHaveBeenCalled();
  });

  it('takes over from the notice when a version arrives meanwhile, and then keeps waiting', () => {
    registration.set({ offlineReady: true });
    render(<UpdatePrompt />);
    expect(screen.queryByText(NOTICE)).not.toBeNull();

    act(() => {
      registration.set({ needRefresh: true });
    });
    expect(screen.queryByText(PROMPT)).not.toBeNull();
    expect(screen.queryByText(NOTICE)).toBeNull();

    // The notice's timer and listeners went with it: nothing of it can close the prompt.
    act(() => {
      vi.advanceTimersByTime(HOUR);
    });
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText(PROMPT)).not.toBeNull();
    expect(registration.updateServiceWorker).not.toHaveBeenCalled();
  });
});
