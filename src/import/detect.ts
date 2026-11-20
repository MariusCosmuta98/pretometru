export type InputKind = 'pdf' | 'image' | 'text';

/** Number of leading bytes `detectInputKind` needs. */
export const SNIFF_BYTES = 1024;

const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  signature.every((byte, index) => bytes[index] === byte);

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

// The PDF specification lets the header sit anywhere in the first 1024 bytes.
const hasPdfHeader = (head: Uint8Array) => ascii(head, 0, SNIFF_BYTES).includes('%PDF-');

/** What the first bytes of a file say it is, regardless of its name or declared type. */
function sniff(head: Uint8Array): InputKind | undefined {
  if (hasPdfHeader(head)) return 'pdf';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image'; // JPEG
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return 'image'; // PNG
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) return 'image'; // GIF
  if (startsWith(head, [0x42, 0x4d])) return 'image'; // BMP
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'image';
  if (ascii(head, 4, 8) === 'ftyp') return 'image'; // HEIC/HEIF/AVIF
  return undefined;
}

const PDF_EXTENSION = /\.pdf$/i;
const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i;
const TEXT_EXTENSION = /\.(?:txt|text)$/i;

/**
 * Decides how a picked file is read. The signature wins over the name and the declared MIME type
 * (phones and share sheets are sloppy with both); the declared type is the fallback. A file that
 * claims to be a PDF without the signature is still sent to the PDF engine, which reports it as
 * unreadable.
 */
export function detectInputKind(
  file: { name: string; type: string },
  head: Uint8Array,
): InputKind | undefined {
  const sniffed = sniff(head);
  if (sniffed) return sniffed;

  const type = file.type.toLowerCase();
  if (type === 'application/pdf' || PDF_EXTENSION.test(file.name)) return 'pdf';
  if (type.startsWith('text/') || TEXT_EXTENSION.test(file.name)) return 'text';
  if (type.startsWith('image/') || IMAGE_EXTENSION.test(file.name)) return 'image';
  return undefined;
}
