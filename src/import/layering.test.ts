import { describe, expect, it } from 'vitest';

// `import.meta.glob` with `?raw` gives the source text of every module in this folder.
const sources = import.meta.glob<string>('./**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const UI_IMPORTS = [
  /from\s+['"]react(?:-dom|-router)?(?:\/[^'"]*)?['"]/,
  /from\s+['"]@\/(?:features|app|ui|pwa)(?:\/[^'"]*)?['"]/,
];

describe('src/import layering (docs/architecture.md §1)', () => {
  it('stays React-free and never reaches into the screens or the app shell', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.endsWith('.test.ts') && !path.endsWith('/testing.ts'))
      .filter(([, source]) => UI_IMPORTS.some((pattern) => pattern.test(source)))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
    // The glob found the module's files (a typo in the pattern would make the test vacuous).
    expect(Object.keys(sources)).toContain('./pipeline.ts');
  });
});
