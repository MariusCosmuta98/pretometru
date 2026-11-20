import type { Plugin } from 'vite';

export type CspDirectives = Readonly<Record<string, readonly string[]>>;

// GitHub Pages cannot set headers, so the policy ships as a <meta> tag (see cspPlugin).
// Plan §11: no CDN/analytics/fonts at runtime; the only allowed remote origins are the
// GitHub API (sync) and the Gemini API (opt-in).
export const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  // 'wasm-unsafe-eval' lets WebAssembly compile (Tesseract.js); it does not enable eval().
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'style-src': ["'self'"],
  // data:/blob: for receipt previews and canvas-generated line crops.
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'", 'https://api.github.com', 'https://generativelanguage.googleapis.com'],
  // pdf.js and Tesseract.js run in workers, which may be created from blob: URLs.
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
} as const satisfies CspDirectives;

export function buildCsp(directives: CspDirectives = CSP_DIRECTIVES): string {
  return Object.entries(directives)
    .map(([name, sources]) => [name, ...sources].join(' '))
    .join('; ');
}

// Build-only: the dev server needs inline scripts (HMR, React Refresh) and websockets.
export function cspPlugin(directives: CspDirectives = CSP_DIRECTIVES): Plugin {
  return {
    name: 'pretometru:csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: buildCsp(directives) },
        injectTo: 'head-prepend',
      },
    ],
  };
}
