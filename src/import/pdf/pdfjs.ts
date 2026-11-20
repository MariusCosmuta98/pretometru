import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export type PdfJs = typeof import('pdfjs-dist');

/**
 * The only place that imports pdf.js, and only when a PDF is read (a dynamic import, so Vite
 * keeps pdf.js in a chunk of its own). The worker is a build asset served from the app's own
 * origin, which the CSP allows (`worker-src 'self'`); nothing comes from a CDN.
 */
export async function loadPdfJs(): Promise<PdfJs> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}
