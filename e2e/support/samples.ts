import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

/*
 * Inputs for the import flows: a real PDF and a real photo of a receipt, made on the fly from the
 * repository's sanitized fixtures, so no binary (and no personal data) is committed.
 */

interface PdfTextSource {
  pages: Array<{
    width: number;
    height: number;
    items: Array<{ str: string; x: number; y: number }>;
  }>;
}

const fixture = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../tests/fixtures/${path}`, import.meta.url)), 'utf8');

/** Courier has no Romanian letters in WinAnsi: the parsers accept the plain ones. */
const ascii = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[()\\]/g, (char) => `\\${char}`);

/**
 * A one-page text PDF that carries the text items of a fixture where the original had them (the
 * original receipt is set in a monospaced font too, so the rows come out the same in pdf.js).
 */
export function pdfFromFixture(id = 'real/kaufland-2026-11-07'): Buffer {
  const source = JSON.parse(fixture(`${id}/source.pdf-text.json`)) as PdfTextSource;
  const page = source.pages[0];
  if (!page) throw new Error(`The fixture ${id} has no page`);

  const text = page.items
    .filter((item) => item.str.trim() !== '')
    .map((item) => `BT /F1 42 Tf 1 0 0 1 ${item.x} ${item.y} Tm (${ascii(item.str)}) Tj ET`)
    .join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/**
 * The text of the Lidl Plus screenshot of the fixtures, from the store's name to the date, without the
 * rows that the sanitizer masked (`Xxxx 0000`).
 */
function lidlText(): string[] {
  const { text } = JSON.parse(fixture('real/lidl-2026-12-29/source.pasted-text.json')) as {
    text: string;
  };
  return text.split('\n').filter((line) => !/^[Xx0\s:/.\-“!>]*$/.test(line));
}

/**
 * A screenshot-like PNG of the Lidl receipt: black text on white, drawn in the browser (the app then
 * reads it with the OCR engine like any photo). Returns the PNG bytes.
 */
export async function receiptPhoto(page: Page): Promise<Buffer> {
  const lines = lidlText();
  const base64 = await page.evaluate(async (rows) => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 80 + rows.length * 54;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000';
    context.font = '34px "Courier New", Courier, monospace';
    rows.forEach((row, index) => {
      context.fillText(row, 40, 70 + index * 54);
    });
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
    if (!blob) throw new Error('The canvas could not be encoded');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, lines);
  return Buffer.from(base64, 'base64');
}
