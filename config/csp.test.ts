import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, createServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCsp, CSP_DIRECTIVES, cspPlugin } from './csp';

const INDEX_HTML =
  '<!doctype html><html><head><title>t</title></head><body><script type="module" src="/main.js"></script></body></html>';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pretometru-csp-'));
  await writeFile(join(root, 'index.html'), INDEX_HTML);
  await writeFile(join(root, 'main.js'), 'console.log(1);');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('buildCsp', () => {
  it('joins sources with spaces and directives with "; " (browsers silently drop malformed policies)', () => {
    expect(buildCsp({ 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'] })).toBe(
      "default-src 'self'; img-src 'self' data:",
    );
  });
});

describe('shipped policy', () => {
  const EXTERNAL_ORIGINS_ALLOWED_BY_PLAN = [
    'https://api.github.com',
    'https://generativelanguage.googleapis.com',
  ];
  const LOCAL_SOURCES = ["'self'", "'none'", "'wasm-unsafe-eval'", 'data:', 'blob:'];

  it('only talks to origins the plan allows (no CDN, analytics or font hosts)', () => {
    const sources = Object.values(CSP_DIRECTIVES).flat();
    const unexpected = sources.filter(
      (s) => !LOCAL_SOURCES.includes(s) && !EXTERNAL_ORIGINS_ALLOWED_BY_PLAN.includes(s),
    );
    expect(unexpected).toEqual([]);
  });

  it('does not allow inline or eval-based script execution', () => {
    expect(CSP_DIRECTIVES['script-src']).not.toContain("'unsafe-inline'");
    expect(CSP_DIRECTIVES['script-src']).not.toContain("'unsafe-eval'");
    expect(CSP_DIRECTIVES['default-src']).toEqual(["'self'"]);
  });
});

describe('cspPlugin', () => {
  it('puts the policy meta tag before any script in the built index.html', async () => {
    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [cspPlugin()],
      build: { write: false },
    });
    const outputs = Array.isArray(result)
      ? result.flatMap((r) => r.output)
      : 'output' in result
        ? result.output
        : [];
    const html = outputs.find((o) => o.fileName === 'index.html');
    const source = html && html.type === 'asset' ? String(html.source) : '';

    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(source);
    expect(meta?.index).toBeLessThan(source.indexOf('<script'));
    // Vite HTML-escapes the attribute; browsers decode it back before parsing the policy.
    const policy = (meta?.[1] ?? '').replaceAll('&#39;', "'").replaceAll('&amp;', '&');
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
  });

  it('leaves dev-server HTML untouched (HMR and React Refresh need inline scripts)', async () => {
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      appType: 'custom',
      server: { middlewareMode: true },
      plugins: [cspPlugin()],
    });
    try {
      const html = await server.transformIndexHtml('/index.html', INDEX_HTML);
      expect(html).not.toContain('Content-Security-Policy');
    } finally {
      await server.close();
    }
  });
});
