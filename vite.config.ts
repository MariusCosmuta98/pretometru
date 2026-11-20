import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import { cspPlugin } from './config/csp.ts';
import { ocrAssetsPlugin } from './config/ocr-assets.ts';
import { offlineGuard } from './config/offline-guard.ts';
import { SHARE_ACCEPT, SHARE_FIELD, SHARE_TARGET_PATH } from './src/pwa/share-target.ts';

// GitHub Pages serves the project site under /<repo>/. Override with BASE_PATH if the repo is renamed.
const base = `/${(process.env.BASE_PATH ?? '/pretometru/').replace(/^\/+|\/+$/g, '')}/`;

export default defineConfig(({ mode }) => {
  const guard = offlineGuard();

  return {
    base,
    plugins:
      mode === 'test'
        ? [react()]
        : [
            react(),
            tailwindcss(),
            cspPlugin(),
            ocrAssetsPlugin(),
            guard.plugin,
            VitePWA({
              // The service worker is src/pwa/sw.ts: precache of the shell, engines cached on first use,
              // the Web Share Target handler. `prompt`: an update waits for the user (UpdatePrompt).
              strategies: 'injectManifest',
              srcDir: 'src/pwa',
              filename: 'sw.ts',
              registerType: 'prompt',
              injectRegister: false,
              includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
              manifest: {
                id: base,
                name: 'Pretometru',
                short_name: 'Pretometru',
                description: 'Prețurile din bonurile tale, comparate pe magazine.',
                lang: 'ro',
                theme_color: '#0f766e',
                background_color: '#f8fafc',
                display: 'standalone',
                categories: ['finance', 'shopping'],
                icons: [
                  { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
                  { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
                  {
                    src: 'pwa-maskable-512x512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                  },
                ],
                // Android Chrome, installed app: receipts shared from the gallery or the Files app
                // arrive as a POST that the service worker answers (src/pwa/share-target.ts).
                share_target: {
                  action: `${base}${SHARE_TARGET_PATH}`,
                  method: 'POST',
                  enctype: 'multipart/form-data',
                  params: { files: [{ name: SHARE_FIELD, accept: [...SHARE_ACCEPT] }] },
                },
              },
              injectManifest: {
                // Everything the build emits is listed; the service worker precaches the app shell and
                // leaves the engines (ENGINE_RULES in src/pwa/offline-rules.ts) for first use, and the
                // guard fails the build if a heavy file would be precached or a file is missing.
                globPatterns: ['**/*'],
                globIgnores: ['**/*.map'],
                maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
                manifestTransforms: [guard.transform],
              },
            }),
          ],
    resolve: {
      alias: {
        '@fixtures': fileURLToPath(new URL('./tests/fixtures', import.meta.url)),
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    test: {
      environment: 'node',
      include: [
        'src/**/*.test.{ts,tsx}',
        'tests/**/*.test.ts',
        'config/**/*.test.ts',
        'scripts/**/*.test.ts',
      ],
      // Testing Library waits 5 s instead of 1 s in component tests (see the file).
      setupFiles: ['./tests/setup.ts'],
      // Headroom above those waits: a component test chains several of them on a busy machine.
      testTimeout: 15_000,
    },
  };
});
