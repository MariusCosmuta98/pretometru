import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, EncryptedSecretSchema } from './vault';

// Few rounds: the tests are about the construction, not about how slow a guess is.
const ROUNDS = 1000;
const SECRET = 'fake-token-for-tests';

describe('encryptSecret and decryptSecret', () => {
  it('open a secret with the passphrase it was sealed with', async () => {
    const vault = await encryptSecret(SECRET, 'parola mea, cu diacritice: ăîșțâ', ROUNDS);
    expect(await decryptSecret(vault, 'parola mea, cu diacritice: ăîșțâ')).toBe(SECRET);
  });

  it('keep the secret out of what is stored, and use a fresh salt and IV every time', async () => {
    const first = await encryptSecret(SECRET, 'parola', ROUNDS);
    const second = await encryptSecret(SECRET, 'parola', ROUNDS);

    const stored = JSON.stringify(first);
    expect(stored).not.toContain(SECRET);
    expect(stored).not.toContain(btoa(SECRET));
    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.data).not.toBe(second.data);
    expect(EncryptedSecretSchema.safeParse(first).success).toBe(true);
  });

  it('refuse a wrong passphrase and a tampered vault alike', async () => {
    const vault = await encryptSecret(SECRET, 'parola', ROUNDS);
    await expect(decryptSecret(vault, 'alta parolă')).rejects.toMatchObject({
      code: 'BAD_PASSPHRASE',
    });

    const flipped = Uint8Array.from(atob(vault.data), (char) => char.charCodeAt(0));
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    const tampered = { ...vault, data: btoa(String.fromCharCode(...flipped)) };
    await expect(decryptSecret(tampered, 'parola')).rejects.toMatchObject({
      code: 'BAD_PASSPHRASE',
    });
    await expect(decryptSecret({ ...vault, iv: vault.salt }, 'parola')).rejects.toMatchObject({
      code: 'BAD_PASSPHRASE',
    });
  });

  it('read the number of rounds from the vault, so older vaults keep opening', async () => {
    const vault = await encryptSecret(SECRET, 'parola', ROUNDS);
    expect(vault.iterations).toBe(ROUNDS);
    await expect(decryptSecret({ ...vault, iterations: ROUNDS + 1 }, 'parola')).rejects.toThrow();
  });

  it('are not fooled by a stored vault that asks for absurd work', () => {
    const vault = {
      v: 1,
      kdf: 'PBKDF2-SHA256',
      iterations: 4_000_000_000,
      salt: 'AA==',
      iv: 'AA==',
      data: 'AA==',
    };
    expect(EncryptedSecretSchema.safeParse(vault).success).toBe(false);
  });
});
