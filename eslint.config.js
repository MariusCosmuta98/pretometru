import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Pure layers must stay runnable under Node (Vitest) with no DOM, IndexedDB or network.
const BROWSER_ONLY_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'Image',
  'OffscreenCanvas',
].map((name) => ({
  name,
  message: 'This layer must stay pure: no DOM, storage or network access.',
}));

const UI_AND_STORAGE = [
  'react',
  'react-dom',
  'react-dom/*',
  'react-router',
  'react-router/*',
  'dexie',
  '@/storage',
  '@/storage/*',
  '@/features',
  '@/features/*',
  '@/app',
  '@/app/*',
  '@/ui',
  '@/ui/*',
  '@/pwa',
  '@/pwa/*',
  '**/storage',
  '**/storage/*',
  '**/features',
  '**/features/*',
  '**/app',
  '**/app/*',
  '**/ui',
  '**/ui/*',
];

const restrictImports = (group, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group, message }] }],
});

export default defineConfig([
  globalIgnores(['dist', 'dev-dist', 'coverage', 'node_modules', 'tests/fixtures']),

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['vite.config.ts', 'config/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['src/domain/**/*.ts', 'src/parsers/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...BROWSER_ONLY_GLOBALS],
      ...restrictImports(
        [...UI_AND_STORAGE],
        'Pure layers (domain, parsers) must not depend on UI, storage or app code.',
      ),
    },
  },

  {
    files: ['src/domain/**/*.ts'],
    rules: {
      ...restrictImports(
        [...UI_AND_STORAGE, '@/parsers', '@/parsers/*', '**/parsers', '**/parsers/*'],
        'src/domain is the bottom layer: it must not import UI, storage, parsers or app code.',
      ),
    },
  },

  {
    files: ['src/storage/**/*.ts'],
    rules: restrictImports(
      [
        'react',
        'react-dom',
        'react-dom/*',
        'react-router',
        'react-router/*',
        '@/features',
        '@/features/*',
        '@/app',
        '@/app/*',
        '@/ui',
        '@/ui/*',
        '**/features',
        '**/features/*',
        '**/app',
        '**/app/*',
        '**/ui',
        '**/ui/*',
      ],
      'src/storage must not depend on React or UI code.',
    ),
  },
]);
