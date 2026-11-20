import { describe, expect, it } from 'vitest';
import { adler32, crc32, encodePng } from './png';

async function inflate(zlib: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([zlib as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readChunks(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Array<{ type: string; data: Uint8Array; crc: number; expectedCrc: number }> = [];
  let offset = 8;
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const typeBytes = png.subarray(offset + 4, offset + 8);
    chunks.push({
      type: String.fromCharCode(...typeBytes),
      data: png.subarray(offset + 8, offset + 8 + length),
      crc: crc32(png, offset + 4, offset + 8 + length),
      expectedCrc: view.getUint32(offset + 8 + length),
    });
    offset += 12 + length;
  }
  return chunks;
}

describe('checksums', () => {
  it('match the published test vectors', () => {
    const text = new TextEncoder().encode('123456789');
    expect(crc32(text)).toBe(0xcbf43926);
    expect(adler32(new TextEncoder().encode('Wikipedia'))).toBe(0x11e60398);
  });

  it('keeps adler32 exact for data longer than the overflow-safe block', () => {
    const reference = (bytes: Uint8Array) => {
      let a = 1;
      let b = 0;
      for (const byte of bytes) {
        a = (a + byte) % 65521;
        b = (b + a) % 65521;
      }
      return ((b << 16) | a) >>> 0;
    };
    const data = Uint8Array.from({ length: 1 << 20 }, (_, i) =>
      i % 3 === 0 ? 0xff : (i * 31) % 256,
    );
    expect(adler32(data)).toBe(reference(data));
    expect(adler32(new Uint8Array(1 << 20).fill(0xff))).toBe(
      reference(new Uint8Array(1 << 20).fill(0xff)),
    );
  });
});

describe('encodePng', () => {
  const image = { width: 3, height: 2, data: new Uint8Array([0, 10, 20, 30, 40, 255]) };

  it('writes the signature, IHDR, IDAT and IEND chunks with valid CRCs', () => {
    const png = encodePng(image);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const chunks = readChunks(png);
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    for (const chunk of chunks) expect(chunk.crc).toBe(chunk.expectedCrc);

    const header = new DataView(chunks[0]!.data.buffer, chunks[0]!.data.byteOffset, 13);
    expect([header.getUint32(0), header.getUint32(4)]).toEqual([3, 2]);
    expect([chunks[0]!.data[8], chunks[0]!.data[9]]).toEqual([8, 0]); // 8-bit greyscale
  });

  it('stores the scanlines, each with filter byte 0, in a valid zlib stream', async () => {
    const idat = readChunks(encodePng(image)).find((chunk) => chunk.type === 'IDAT')!;
    expect([...(await inflate(idat.data))]).toEqual([0, 0, 10, 20, 0, 30, 40, 255]);
  });

  it('splits big images into several stored blocks and still round-trips', async () => {
    const width = 400;
    const height = 300;
    const data = Uint8Array.from({ length: width * height }, (_, i) => (i * 7) % 256);
    const idat = readChunks(encodePng({ width, height, data })).find((c) => c.type === 'IDAT')!;
    const raw = await inflate(idat.data);

    expect(raw.length).toBe((width + 1) * height);
    expect(raw.length).toBeGreaterThan(0xffff);
    for (const y of [0, 149, 299]) {
      expect(raw[y * (width + 1)]).toBe(0);
      expect([...raw.subarray(y * (width + 1) + 1, (y + 1) * (width + 1))]).toEqual([
        ...data.subarray(y * width, (y + 1) * width),
      ]);
    }
  });

  it('refuses pixel data that does not match the dimensions', () => {
    expect(() => encodePng({ width: 2, height: 2, data: new Uint8Array(3) })).toThrow(RangeError);
    expect(() => encodePng({ width: 0, height: 0, data: new Uint8Array(0) })).toThrow(RangeError);
  });
});
