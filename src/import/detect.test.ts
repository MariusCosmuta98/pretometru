import { describe, expect, it } from 'vitest';
import { detectInputKind, SNIFF_BYTES } from './detect';
import { sha256Hex } from './hash';

const bytes = (...values: Array<number | string>) =>
  Uint8Array.from(
    values.flatMap((value) =>
      typeof value === 'number' ? [value] : [...value].map((char) => char.charCodeAt(0)),
    ),
  );

describe('detectInputKind', () => {
  it('reads the signature, whatever the name and the declared type say', () => {
    expect(detectInputKind({ name: 'a', type: '' }, bytes('%PDF-1.7'))).toBe('pdf');
    expect(detectInputKind({ name: 'x.png', type: 'image/png' }, bytes('%PDF-1.4'))).toBe('pdf');
    expect(
      detectInputKind({ name: 'bon.pdf', type: 'application/pdf' }, bytes(0xff, 0xd8, 0xff)),
    ).toBe('image');
    expect(detectInputKind({ name: 'x', type: '' }, bytes(0x89, 'PNG'))).toBe('image');
    expect(detectInputKind({ name: 'x', type: '' }, bytes('RIFF', 0, 0, 0, 0, 'WEBP'))).toBe(
      'image',
    );
    expect(detectInputKind({ name: 'x', type: '' }, bytes(0, 0, 0, 0x18, 'ftypheic'))).toBe(
      'image',
    );
  });

  it('finds a PDF header preceded by junk within the first kilobyte', () => {
    expect(detectInputKind({ name: 'x', type: '' }, bytes('\n\n  ', '%PDF-1.4'))).toBe('pdf');
    expect(SNIFF_BYTES).toBe(1024);
  });

  it('falls back to the declared type or the extension', () => {
    const none = bytes('hello');
    expect(detectInputKind({ name: 'bon.txt', type: '' }, none)).toBe('text');
    expect(detectInputKind({ name: 'x', type: 'text/plain' }, none)).toBe('text');
    expect(detectInputKind({ name: 'IMG_1.HEIC', type: '' }, none)).toBe('image');
    expect(detectInputKind({ name: 'x', type: 'image/jpeg' }, none)).toBe('image');
    // Claims to be a PDF but is not: the PDF engine reports it as unreadable.
    expect(detectInputKind({ name: 'bon.pdf', type: '' }, none)).toBe('pdf');
  });

  it('rejects other formats', () => {
    expect(detectInputKind({ name: 'a.zip', type: 'application/zip' }, bytes('PK', 3, 4))).toBe(
      undefined,
    );
    expect(detectInputKind({ name: 'a.docx', type: '' }, bytes(1, 2, 3))).toBe(undefined);
  });
});

describe('sha256Hex', () => {
  it('matches the published SHA-256 test vector', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
