import type { GrayImage } from './preprocess';

/**
 * Minimal PNG writer for 8-bit greyscale images. The pixel data goes into "stored" (uncompressed)
 * deflate blocks: no compressor is needed, the result is deterministic and identical in the browser
 * and under Node, and libpng inside Tesseract reads it like any other PNG.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_STORED_BLOCK = 0xffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  // 5552 is the largest block for which the sums cannot overflow 32 bits before the modulo.
  for (let offset = 0; offset < bytes.length; offset += 5552) {
    const end = Math.min(offset + 5552, bytes.length);
    for (let i = offset; i < end; i++) {
      a += bytes[i]!;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function writeChunk(target: Uint8Array, offset: number, type: string, data: Uint8Array): number {
  writeUint32(target, offset, data.length);
  for (let i = 0; i < 4; i++) target[offset + 4 + i] = type.charCodeAt(i);
  target.set(data, offset + 8);
  writeUint32(
    target,
    offset + 8 + data.length,
    crc32(target, offset + 4, offset + 8 + data.length),
  );
  return offset + 12 + data.length;
}

export function encodePng(image: GrayImage): Uint8Array {
  const { width, height, data } = image;
  if (!(width > 0 && height > 0) || data.length !== width * height) {
    throw new RangeError('Invalid greyscale image');
  }

  // Each scanline is prefixed with the filter type byte 0 ("none").
  const rowBytes = width + 1;
  const raw = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    raw.set(data.subarray(y * width, (y + 1) * width), y * rowBytes + 1);
  }

  const blocks = Math.ceil(raw.length / MAX_STORED_BLOCK);
  // zlib header (2) + per block header (5) + data + Adler-32 (4)
  const zlib = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  zlib[0] = 0x78;
  zlib[1] = 0x01;
  let out = 2;
  for (let block = 0; block < blocks; block++) {
    const start = block * MAX_STORED_BLOCK;
    const length = Math.min(MAX_STORED_BLOCK, raw.length - start);
    zlib[out++] = block === blocks - 1 ? 1 : 0;
    zlib[out++] = length & 0xff;
    zlib[out++] = length >>> 8;
    zlib[out++] = ~length & 0xff;
    zlib[out++] = (~length >>> 8) & 0xff;
    zlib.set(raw.subarray(start, start + length), out);
    out += length;
  }
  writeUint32(zlib, out, adler32(raw));

  const header = new Uint8Array(13);
  writeUint32(header, 0, width);
  writeUint32(header, 4, height);
  header[8] = 8; // bit depth
  header[9] = 0; // colour type: greyscale

  const png = new Uint8Array(SIGNATURE.length + (12 + header.length) + (12 + zlib.length) + 12);
  png.set(SIGNATURE, 0);
  let offset = SIGNATURE.length;
  offset = writeChunk(png, offset, 'IHDR', header);
  offset = writeChunk(png, offset, 'IDAT', zlib);
  writeChunk(png, offset, 'IEND', new Uint8Array(0));
  return png;
}
