/**
 * Test-only helpers for the list screens. Never import this from application code.
 */
import { waitFor } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * Focus follows a commit by an effect or by an async write, so wait for it instead of asserting right
 * after a `findBy` (under CPU load the effect can run after the element showed up). Pass a getter
 * when the element can be replaced meanwhile: it is looked up again at every poll.
 */
export async function expectFocus(target: HTMLElement | (() => HTMLElement)): Promise<void> {
  await waitFor(() => {
    expect(document.activeElement).toBe(typeof target === 'function' ? target() : target);
  });
}
