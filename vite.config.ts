import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import { cspPlugin } from './config/csp.ts';
import { ocrAssetsPlugin } from './config/ocr-assets.ts';

// GitHub Pages serves the project site under /<repo>/. Override with BASE_PATH if the repo is renamed.
const base = `/${(process.env.BASE_PATH ?? '/pretometru/').replace(/^\/+|\/+$/g, '')}/`;

export default defineConfig(({ mode }) => ({
  base,
  plugins:
    mode === 'test'
      ? [react()]
      : [
          react(),
          tailwindcss(),
          cspPlugin(),
          ocrAssetsPlugin(),
          VitePWA({
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
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
              // The OCR engine (about 16 MB) is cached on demand by `pwa-offline-share`, not precached.
              globIgnores: ['ocr/**'],
              navigateFallback: 'index.html',
              cleanupOutdatedCaches: true,
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
  },
}));
