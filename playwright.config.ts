import { defineConfig, devices } from '@playwright/test';

// CI checks the built Pages artifact; locally run `npm run e2e` (it builds first).
// Install the browser once with `npx playwright install chromium`,
// or set E2E_CHANNEL=chrome to use the Google Chrome that is already installed.
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // One browser at a time: the OCR engine is heavy and the tests share one origin.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: process.env.CI ? 'off' : 'retain-on-failure',
    ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
  },
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'node e2e/support/serve.ts',
    url: `http://127.0.0.1:${port}/pretometru/`,
    env: { E2E_PORT: String(port) },
    reuseExistingServer: false,
  },
});
