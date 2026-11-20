import { describe, expect, it, vi } from 'vitest';
import { ReceiptSourceSchema } from '@/domain';
import { extractPdfText, textSourceFromDocument, type PdfDocumentLike } from './extract';
import type { PdfJs } from './pdfjs';

const textItem = (str: string, x: number, y: number, width: number, height = 10) => ({
  str,
  transform: [height, 0, 0, height, x, y],
  width,
  height,
  dir: 'ltr',
  fontName: 'g_d0_f1',
  hasEOL: false,
});

function fakeDocument(
  pages: Array<{ width: number; height: number; items: unknown[] }>,
  cleanup = vi.fn(),
): PdfDocumentLike {
  return {
    numPages: pages.length,
    getPage: (number) => {
      const page = pages[number - 1];
      if (!page) return Promise.reject(new Error(`no page ${number}`));
      return Promise.resolve({
        getViewport: () => ({ width: page.width, height: page.height }),
        getTextContent: () => Promise.resolve({ items: page.items }),
        cleanup,
      });
    },
  };
}

describe('textSourceFromDocument', () => {
  it('maps pdf.js items to the source shape, page by page', async () => {
    const source = await textSourceFromDocument(
      fakeDocument([
        {
          width: 595,
          height: 842,
          items: [textItem('TOTAL', 13, 700, 21), textItem('4,12', 240, 700, 17)],
        },
        { width: 595, height: 842, items: [textItem('Pagina 2', 13, 800, 33)] },
      ]),
    );
    expect(source).toEqual({
      kind: 'pdf-text',
      pages: [
        {
          width: 595,
          height: 842,
          items: [
            { str: 'TOTAL', x: 13, y: 700, w: 21, h: 10 },
            { str: '4,12', x: 240, y: 700, w: 17, h: 10 },
          ],
        },
        { width: 595, height: 842, items: [{ str: 'Pagina 2', x: 13, y: 800, w: 33, h: 10 }] },
      ],
    });
    expect(ReceiptSourceSchema.safeParse(source).success).toBe(true);
  });

  it('drops empty strings and marked-content markers but keeps whitespace-only items', async () => {
    const source = await textSourceFromDocument(
      fakeDocument([
        {
          width: 100,
          height: 100,
          items: [
            { type: 'beginMarkedContent', id: 'p1' },
            textItem('', 5, 90, 0),
            textItem(' ', 20, 90, 4.2, 0),
            textItem('A', 30, 90, 4.2),
            { type: 'endMarkedContent' },
          ],
        },
      ]),
    );
    expect(source.pages[0]?.items.map((item) => item.str)).toEqual([' ', 'A']);
  });

  it('releases every page and copes with a document without pages', async () => {
    const cleanup = vi.fn();
    await textSourceFromDocument(
      fakeDocument(
        [
          { width: 10, height: 10, items: [] },
          { width: 10, height: 10, items: [] },
        ],
        cleanup,
      ),
    );
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(await textSourceFromDocument(fakeDocument([]))).toEqual({ kind: 'pdf-text', pages: [] });
  });
});

// A one-page PDF written by hand: two lines of Helvetica text on a 300 x 400 pt page.
function minimalPdf(rows: ReadonlyArray<readonly [text: string, y: number]>): ArrayBuffer {
  const content = rows.map(([text, y]) => `BT /F1 12 Tf 72 ${y} Td (${text}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf).buffer;
}

// The bundled loader needs a browser (a Worker and Vite's asset URL); under Node the legacy build
// of the same pdf.js runs its worker in-process.
async function loadPdfJsForNode(): Promise<PdfJs> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    '../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url,
  ).href;
  return pdfjs;
}

describe('extractPdfText', () => {
  it('reads the text layer of a real PDF into positioned items', async () => {
    const data = minimalPdf([
      ['Hello 12,34', 350],
      ['Second row', 330],
    ]);
    const length = data.byteLength;

    const source = await extractPdfText(data, loadPdfJsForNode);

    expect(ReceiptSourceSchema.safeParse(source).success).toBe(true);
    const [page] = source.pages;
    expect(page).toMatchObject({ width: 300, height: 400 });
    const [first, second] = page?.items.filter((item) => item.str.trim() !== '') ?? [];
    expect(first).toMatchObject({ str: 'Hello 12,34', x: 72, y: 350, h: 12 });
    expect(second).toMatchObject({ str: 'Second row', x: 72, y: 330 });
    expect(first?.w).toBeGreaterThan(40);
    // Higher on the page = larger y, so the parsers read the rows top to bottom.
    expect((first?.y ?? 0) > (second?.y ?? 0)).toBe(true);
    // pdf.js took a copy: the caller's buffer is still whole.
    expect(data.byteLength).toBe(length);
  });

  it('rejects a file that is not a PDF', async () => {
    const garbage = new TextEncoder().encode('this is not a pdf at all').buffer;
    await expect(extractPdfText(garbage, loadPdfJsForNode)).rejects.toThrow();
  });
});
