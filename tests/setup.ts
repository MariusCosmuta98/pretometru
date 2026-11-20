/**
 * Runs before every test file (`test.setupFiles` in vite.config.ts).
 *
 * Component tests (`// @vitest-environment jsdom`) wait on IndexedDB, router loaders and lazily
 * imported route modules. Testing Library gives `findBy*` and `waitFor` 1 s by default, which a busy
 * machine (parallel test files, CI runners) easily exceeds: those tests then failed at random with
 * "Unable to find an element ...". A longer budget costs nothing when the element shows up quickly,
 * because the first match ends the wait. Node tests skip this file's work altogether.
 */
if (typeof document !== 'undefined') {
  const { configure } = await import('@testing-library/dom');
  configure({ asyncUtilTimeout: 5000 });
}
