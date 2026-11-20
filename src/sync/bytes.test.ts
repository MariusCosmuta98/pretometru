import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, gitBlobSha, utf8Bytes, utf8Text } from './bytes';

describe('gitBlobSha', () => {
  // `git hash-object` of the same bytes (the empty file, and the two examples of the Pro Git book).
  it.each([
    ['', 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'],
    ['test content\n', 'd670460b4b4aece5915caf5c68d12f560a9fe3e4'],
    ['hello world\n', '3b18e512dba79e4c8300dd08aeb37f8e728b8dad'],
  ])('matches Git for %j', async (content, sha) => {
    expect(await gitBlobSha(content)).toBe(sha);
  });

  // `printf 'ă' | git hash-object --stdin`: the header counts the two UTF-8 bytes of "ă".
  it('hashes the UTF-8 bytes, not the characters', async () => {
    expect(await gitBlobSha('ă')).toBe('313e13f4cb41f9a9a3110f18c2eaac0c7cb1c3ef');
  });
});

describe('base64', () => {
  it('round-trips bytes of every value, in chunks larger than the encoder step', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => index % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('reads the line breaks GitHub puts into base64', () => {
    const text = 'Cafea măcinată, 250 g — preț 20,00 lei '.repeat(5);
    const wrapped = bytesToBase64(utf8Bytes(text)).replace(/(.{60})/g, '$1\n');
    expect(utf8Text(base64ToBytes(wrapped))).toBe(text);
  });

  it('refuses bytes that are not UTF-8 text instead of replacing them', () => {
    expect(() => utf8Text(Uint8Array.of(0xff, 0xfe, 0xfd))).toThrow();
  });
});
