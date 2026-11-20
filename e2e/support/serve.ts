import { startPagesServer } from './pages-server.ts';

// Started by Playwright (`webServer` in playwright.config.ts): serves the production build in dist/.
const port = Number(process.env.E2E_PORT ?? 4173);
const server = await startPagesServer({ root: 'dist', port });
console.log(`Serving dist/ at ${server.url()}`);
