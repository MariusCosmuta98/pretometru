import { z } from 'zod';
import { base64ToBytes, bytesToBase64, cryptoApi, utf8Bytes, utf8Text } from './bytes';
import { SyncError } from './errors';

/** OWASP's 2023 figure for PBKDF2-HMAC-SHA256. */
export const DEFAULT_PASSPHRASE_ITERATIONS = 600_000;

const MAX_ITERATIONS = 10_000_000;
// Binds a vault to its purpose: it cannot be decrypted as something else, or the other way round.
const CONTEXT = utf8Bytes('pretometru:sync-token:v1');

export const EncryptedSecretSchema = z.strictObject({
  v: z.literal(1),
  kdf: z.literal('PBKDF2-SHA256'),
  iterations: z.int().min(1).max(MAX_ITERATIONS),
  salt: z.string().min(1),
  iv: z.string().min(1),
  data: z.string().min(1),
});
export type EncryptedSecret = z.infer<typeof EncryptedSecretSchema>;

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const { subtle } = cryptoApi();
  const material = await subtle.importKey('raw', utf8Bytes(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** AES-256-GCM under a key derived from the passphrase (PBKDF2); fresh salt and IV every time. */
export async function encryptSecret(
  secret: string,
  passphrase: string,
  iterations = DEFAULT_PASSPHRASE_ITERATIONS,
): Promise<EncryptedSecret> {
  const api = cryptoApi();
  const salt = api.getRandomValues(new Uint8Array(16));
  const iv = api.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const data = await api.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: CONTEXT },
    key,
    utf8Bytes(secret),
  );
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(data)),
  };
}

/** A wrong passphrase and a tampered vault are the same failure: AES-GCM cannot tell them apart. */
export async function decryptSecret(vault: EncryptedSecret, passphrase: string): Promise<string> {
  const { subtle } = cryptoApi();
  try {
    const key = await deriveKey(passphrase, base64ToBytes(vault.salt), vault.iterations);
    const plain = await subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(vault.iv), additionalData: CONTEXT },
      key,
      base64ToBytes(vault.data),
    );
    return utf8Text(new Uint8Array(plain));
  } catch (error) {
    throw new SyncError('BAD_PASSPHRASE', 'The passphrase does not open the saved token', {
      cause: error,
    });
  }
}
