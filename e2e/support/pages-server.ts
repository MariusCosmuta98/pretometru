import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.gz': 'application/gzip',
};

export interface PagesServer {
  /** `http://127.0.0.1:<port>` */
  origin: string;
  /** Absolute URL of a path below the base (`url('ocr/worker.min.js')`). */
  url(path?: string): string;
  close(): Promise<void>;
}

export interface PagesServerOptions {
  /** The build output to serve. */
  root: string;
  /** The Vite base the app was built for. */
  base?: string;
  /** 0 picks a free port. */
  port?: number;
}

/**
 * Serves a build the way GitHub Pages does, which is stricter than `vite preview`: files below the
 * base only, no fallback to `index.html` for an unknown path (so a chunk that is missing from the
 * offline cache fails loudly instead of turning into HTML), and no POST at all. Responses are
 * `no-store` (Pages says `max-age=600`) on purpose: with a fresh copy in the browser's HTTP cache an
 * offline check would pass even if the service worker had not stored the file.
 */
export function startPagesServer({
  root,
  base = '/pretometru/',
  port = 0,
}: PagesServerOptions): Promise<PagesServer> {
  const directory = resolve(root);

  const server: Server = createServer((request, response) => {
    void (async () => {
      const { pathname } = new URL(request.url ?? '/', 'http://localhost');
      const notFound = () => {
        response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      };
      if (request.method !== 'GET' && request.method !== 'HEAD') return notFound();
      if (!pathname.startsWith(base)) return notFound();

      const relative = decodeURIComponent(pathname.slice(base.length)) || 'index.html';
      const file = normalize(join(directory, relative));
      if (!file.startsWith(directory + sep)) return notFound();

      const info = await stat(file).catch(() => undefined);
      if (!info?.isFile()) return notFound();
      response.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'content-length': info.size,
        'cache-control': 'no-store',
      });
      if (request.method === 'HEAD') return void response.end();
      createReadStream(file).pipe(response);
    })();
  });

  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      const origin = `http://127.0.0.1:${actual}`;
      resolveServer({
        origin,
        url: (path = '') => `${origin}${base}${path}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}
