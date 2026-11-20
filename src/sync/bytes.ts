import { SyncError } from './errors';

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(binary);
}

/** Decodes base64 as GitHub writes it, with line breaks every 60 characters. */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function utf8Bytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

/** Strict UTF-8: bytes that are not text (a corrupted or foreign file) are an error, not U+FFFD. */
export function utf8Text(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function cryptoApi(): Crypto {
  const api = globalThis.crypto as Crypto | undefined;
  if (!api?.subtle) {
    throw new SyncError('CRYPTO_UNAVAILABLE', 'WebCrypto is not available in this context');
  }
  return api;
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * The id Git gives a file's content (SHA-1 of `blob <size>\0<content>`). Two files with the same id
 * are the same file, which is how a sync skips what is already identical on both sides.
 */
export async function gitBlobSha(content: string): Promise<string> {
  const body = utf8Bytes(content);
  const header = utf8Bytes(`blob ${body.length}\0`);
  const whole = new Uint8Array(header.length + body.length);
  whole.set(header);
  whole.set(body, header.length);
  return hex(new Uint8Array(await cryptoApi().subtle.digest('SHA-1', whole)));
}
