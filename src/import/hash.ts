/** Lower-case hex SHA-256 of the bytes, or `undefined` where WebCrypto is unavailable (insecure context). */
export async function sha256Hex(data: BufferSource): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle as SubtleCrypto | undefined;
  if (!subtle) return undefined;
  const digest = await subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
