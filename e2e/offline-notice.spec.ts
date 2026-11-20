import { expect, test, type Page } from '@playwright/test';
import { startPagesServer } from './support/pages-server.ts';
import { pdfFromFixture } from './support/samples.ts';

/*
 * "Aplicația poate fi folosită și fără internet" shows once, on the first launch, as soon as the service
 * worker has installed. It is fixed above the bottom navigation, which is where the last controls of a long
 * screen end up when the page is scrolled to its end: at 412 x 839 it sat over "Șterge bonul" at the end of
 * a receipt review and took the tap until it was closed by hand. It only informs, so it must never take one.
 * (The new-version prompt is the opposite, a choice that waits for the user: update.spec.ts and
 * src/pwa/UpdatePrompt.test.tsx.)
 */

// The phone of the acceptance run: Pixel 7, 412 x 839 CSS px, touch input.
test.use({ viewport: { width: 412, height: 839 } });

/**
 * A first launch with the worker's install held back: the notice appears when `installWorker()` is called,
 * so a test can first put the page in the state it needs (on a real first launch the notice appears about
 * a second after the page has loaded, whatever the user is doing at that moment).
 */
async function firstLaunch() {
  let installWorker = () => {};
  const held = new Promise<void>((resolve) => {
    installWorker = resolve;
  });
  const server = await startPagesServer({ root: 'dist', waitForShellPrecache: held });
  return {
    server,
    installWorker,
    close: async () => {
      installWorker();
      await server.close();
    },
  };
}

const noticeOn = (page: Page) => page.getByRole('status').filter({ hasText: 'fără internet' });

test('the "works offline" notice takes no tap from the end of a receipt review', async ({
  page,
}) => {
  const { server, installWorker, close } = await firstLaunch();
  try {
    await page.goto(server.url('#/adauga'));
    // A sanitized draft: the Kaufland fixture, made into a text PDF.
    await page.getByLabel('Alege fișiere').setInputFiles({
      name: 'kaufland.pdf',
      mimeType: 'application/pdf',
      buffer: pdfFromFixture(),
    });
    await expect(page.getByRole('heading', { level: 2, name: 'Detalii bon' })).toBeVisible({
      timeout: 60_000,
    });
    const remove = page.getByRole('button', { name: 'Șterge bonul' });
    await expect(remove).toBeVisible();
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });

    installWorker();
    const notice = noticeOn(page);
    await expect(notice).toBeVisible();

    // Where the notice and the button overlap, and what a tap there would reach, in one synchronous look.
    const probe = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find(
        (candidate) => candidate.textContent.trim() === 'Șterge bonul',
      );
      const status = [...document.querySelectorAll('[role=status]')].find((candidate) =>
        candidate.textContent.includes('fără internet'),
      );
      if (!button) return { state: 'no-button' as const };
      if (!status) return { state: 'notice-gone' as const };
      const b = button.getBoundingClientRect();
      const n = status.getBoundingClientRect();
      const left = Math.max(b.left, n.left);
      const right = Math.min(b.right, n.right);
      const top = Math.max(b.top, n.top);
      const bottom = Math.min(b.bottom, n.bottom);
      if (right <= left || bottom <= top) return { state: 'no-overlap' as const };
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        state: 'overlap' as const,
        reachesButton: hit !== null && button.contains(hit),
        reaches: hit
          ? `<${hit.tagName.toLowerCase()}> "${hit.textContent.trim().slice(0, 50)}"`
          : 'nothing',
        position: { x: x - b.left, y: y - b.top },
      };
    });
    // Without an overlap the tap below would prove nothing: say so instead of passing quietly.
    if (probe.state === 'notice-gone') {
      throw new Error(
        'The notice went away on its own before it could be checked (it lasts 8 s): the machine is too slow.',
      );
    }
    if (probe.state !== 'overlap') {
      throw new Error(
        `The notice no longer covers "Șterge bonul" at 412 x 839 (${probe.state}), so this test no longer ` +
          'reproduces the acceptance scenario: look at the layout (src/app/AppLayout.tsx, src/pwa/UpdatePrompt.tsx).',
      );
    }
    expect(
      probe.reachesButton,
      `a tap on the covered part of the button reaches ${probe.reaches}`,
    ).toBe(true);

    // The same with a real touch, aimed at the part of the button under the notice.
    await remove.tap({ position: probe.position, timeout: 10_000 });
    await expect(page.getByRole('dialog', { name: 'Ștergi bonul?' })).toBeVisible();
    // Touching the page is also what ends the notice.
    await expect(notice).toBeHidden();
  } finally {
    await close();
  }
});

test('a key press ends the notice, and there is nothing in it for Tab to land on', async ({
  page,
}) => {
  const { server, installWorker, close } = await firstLaunch();
  try {
    await page.goto(server.url());
    await expect(page.getByRole('heading', { level: 1, name: 'Acasă' })).toBeVisible();
    installWorker();
    const notice = noticeOn(page);
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('button')).toHaveCount(0);
    await expect(notice.locator('a, input, select, textarea, [tabindex]')).toHaveCount(0);

    await page.keyboard.press('Tab');

    await expect(notice).toBeHidden();
  } finally {
    await close();
  }
});
