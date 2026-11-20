import { describe, expect, it } from 'vitest';

/*
 * The isolation of the optional Gemini reading, as the shape of the source: what keeps "nothing
 * loads or runs unless the feature is on" true when somebody adds a line later. The runtime side
 * (no request to Google with the feature off, the engine chunks never fetched) is checked on the
 * production build by e2e/ai.spec.ts.
 */
const raw = import.meta.glob<string>('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const files = Object.entries(raw).map(([path, text]) => ({
  name: path.replace(/^\/src\//, ''),
  text,
}));
const outsideAi = files.filter((file) => !file.name.startsWith('ai/'));
const isTestSupport = (name: string) => /\.test\.tsx?$|(^|\/)testing\.tsx?$/.test(name);

/** The modules that load with the first reading or connection test, never with the app shell. */
const ENGINE = ['client', 'read', 'connection', 'convert', 'prompt', 'image', 'values'];
/** The modules the app shell may load: the settings, the texts, the errors, the lazy wrappers. */
const LIGHT = ['index', 'config', 'messages', 'notice', 'errors', 'services', 'types'];

describe('the isolation of the Gemini reading', () => {
  it('has one module that names the Gemini host: src/ai', () => {
    const naming = outsideAi.filter((file) => file.text.includes('generativelanguage'));
    expect(naming.map((file) => file.name)).toEqual([]);
  });

  it('never lets the app shell load the engine: the light modules import it only as types', () => {
    const staticEngineImport = new RegExp(
      `^(?:import|export)(?!\\s+type\\b)[^;]*?from\\s+'\\./(?:${ENGINE.join('|')})'`,
      'm',
    );
    for (const name of LIGHT) {
      const file = files.find((candidate) => candidate.name === `ai/${name}.ts`);
      expect(file, name).toBeDefined();
      expect(
        staticEngineImport.test(file?.text ?? ''),
        `ai/${name}.ts imports the engine statically`,
      ).toBe(false);
    }
  });

  it('reaches the engine through the barrel only: application code never imports its modules', () => {
    const deepImport = new RegExp(`from\\s+'@/ai/(?:${[...ENGINE, 'mock-gemini'].join('|')})'`);
    const offenders = outsideAi.filter(
      (file) => !isTestSupport(file.name) && deepImport.test(file.text),
    );
    expect(offenders.map((file) => file.name)).toEqual([]);
  });

  it('loads the engine with a dynamic import, in the wrappers of the barrel', () => {
    const barrel = files.find((file) => file.name === 'ai/index.ts')?.text ?? '';
    expect(barrel).toContain("await import('./read')");
    expect(barrel).toContain("await import('./connection')");
  });
});
