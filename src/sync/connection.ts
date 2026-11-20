import { z } from 'zod';
import { InstantSchema } from '@/domain';
import { deleteKeyValue, getKeyValue, setKeyValue, type PretometruDB } from '@/storage';
import { SyncError } from './errors';
import { isValidRepoRef } from './github';
import { setSyncRuntime } from './runtime';
import type { SyncServices } from './services';
import { decryptSecret, EncryptedSecretSchema, encryptSecret } from './vault';

/*
 * Everything about the connection lives in `syncState`: a device-local table that is never exported,
 * never synced and never part of a backup. The token has a row of its own, so that reading the
 * connection never touches it. Deleting a row leaves a tombstone with `value: null`.
 */
export const CONNECTION_KEY = 'sync.connection';
export const TOKEN_KEY = 'sync.token';
export const STATUS_KEY = 'sync.status';

const ConnectionSchema = z.strictObject({
  owner: z.string(),
  repo: z.string(),
  /** Tells this device's commits apart in the repository history. */
  deviceId: z.string().min(1),
  /** Sync by itself: when the app starts or is opened again, when back online, after changes. */
  auto: z.boolean(),
  connectedAt: InstantSchema,
});
export type Connection = z.infer<typeof ConnectionSchema>;

const TokenSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('plain'), token: z.string().min(1) }),
  z.strictObject({ kind: z.literal('passphrase'), vault: EncryptedSecretSchema }),
]);
type StoredToken = z.infer<typeof TokenSchema>;

export type TokenProtection = 'none' | 'passphrase';

/** What a connection is made of: where the data goes and the key to it. */
export interface ConnectionInput {
  owner: string;
  repo: string;
  token: string;
  /** Encrypts the token with this passphrase (WebCrypto); it is asked again after every app start. */
  passphrase?: string | undefined;
}

type ConnectionServices = Pick<SyncServices, 'now' | 'newDeviceId' | 'passphraseIterations'>;

// Only in memory, never persisted: gone when the page is closed.
let unlockedToken: string | undefined;

export function lockToken(): void {
  unlockedToken = undefined;
  setSyncRuntime({ unlocked: false });
}

async function readStoredToken(db: PretometruDB): Promise<StoredToken | undefined> {
  const parsed = TokenSchema.safeParse(await getKeyValue(db.syncState, TOKEN_KEY));
  return parsed.success ? parsed.data : undefined;
}

export async function readConnection(db: PretometruDB): Promise<Connection | undefined> {
  const parsed = ConnectionSchema.safeParse(await getKeyValue(db.syncState, CONNECTION_KEY));
  return parsed.success && isValidRepoRef(parsed.data.owner, parsed.data.repo)
    ? parsed.data
    : undefined;
}

export async function readTokenProtection(db: PretometruDB): Promise<TokenProtection | undefined> {
  const stored = await readStoredToken(db);
  if (stored === undefined) return undefined;
  return stored.kind === 'plain' ? 'none' : 'passphrase';
}

async function storedTokenOf(
  token: string,
  passphrase: string | undefined,
  iterations: number,
): Promise<StoredToken> {
  return passphrase
    ? { kind: 'passphrase', vault: await encryptSecret(token, passphrase, iterations) }
    : { kind: 'plain', token };
}

/**
 * Saves the repository and the token (encrypted when a passphrase is given). A device keeps its
 * id and its automatic-sync choice when the token or repository is replaced.
 */
export async function saveConnection(
  db: PretometruDB,
  input: ConnectionInput,
  services: ConnectionServices,
): Promise<Connection> {
  if (!isValidRepoRef(input.owner, input.repo)) {
    throw new SyncError('INVALID_REPO', 'The repository name is not valid');
  }
  const stored = await storedTokenOf(input.token, input.passphrase, services.passphraseIterations);
  const previous = await readConnection(db);
  const connection: Connection = {
    owner: input.owner,
    repo: input.repo,
    deviceId: previous?.deviceId ?? services.newDeviceId(),
    auto: previous?.auto ?? true,
    connectedAt: services.now().toISOString(),
  };

  const context = { now: services.now };
  await db.transaction('rw', db.syncState, async () => {
    // The token first: a connection without a token is useless, a token alone is harmless.
    await setKeyValue(db.syncState, TOKEN_KEY, stored, context);
    await setKeyValue(db.syncState, CONNECTION_KEY, connection, context);
  });

  unlockedToken = stored.kind === 'passphrase' ? input.token : undefined;
  // A new or changed connection starts its own history: what the old one came to no longer applies.
  setSyncRuntime({ unlocked: stored.kind === 'passphrase', lastAttempt: undefined });
  return connection;
}

export async function setAutoSync(
  db: PretometruDB,
  auto: boolean,
  services: Pick<SyncServices, 'now'>,
): Promise<void> {
  const connection = await readConnection(db);
  if (connection) {
    await setKeyValue(db.syncState, CONNECTION_KEY, { ...connection, auto }, services);
  }
}

/** Removes the token and the connection from this device. Local data and the repository stay as they are. */
export async function disconnect(
  db: PretometruDB,
  services: Pick<SyncServices, 'now'>,
): Promise<void> {
  await db.transaction('rw', db.syncState, async () => {
    for (const key of [TOKEN_KEY, CONNECTION_KEY, STATUS_KEY]) {
      await deleteKeyValue(db.syncState, key, services);
    }
  });
  lockToken();
  setSyncRuntime({ lastAttempt: undefined });
}

/** Opens a passphrase-protected token for this session. Throws `BAD_PASSPHRASE` when it does not fit. */
export async function unlockToken(db: PretometruDB, passphrase: string): Promise<void> {
  const stored = await readStoredToken(db);
  if (stored?.kind !== 'passphrase') return;
  unlockedToken = await decryptSecret(stored.vault, passphrase);
  setSyncRuntime({ unlocked: true });
}

/** The token to use now: the plain one, or the one unlocked in this session. */
export async function resolveToken(db: PretometruDB): Promise<string> {
  const stored = await readStoredToken(db);
  if (stored === undefined)
    throw new SyncError('NOT_CONFIGURED', 'No token is saved on this device');
  if (stored.kind === 'plain') return stored.token;
  if (unlockedToken !== undefined) return unlockedToken;
  throw new SyncError('TOKEN_LOCKED', 'The token is protected by a passphrase');
}
