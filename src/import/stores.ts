import type { Chain, Store } from '@/domain';
import { createRecord, type PretometruDB, type StorageContext } from '@/storage';

/** Display names of the supported chains; `unknown` stands for any other shop. */
export const CHAIN_LABELS: Readonly<Record<Chain, string>> = {
  kaufland: 'Kaufland',
  metro: 'METRO',
  'mega-image': 'Mega Image',
  lidl: 'Lidl',
  unknown: 'Alt magazin',
};

export function chainLabel(chain: Chain): string {
  return CHAIN_LABELS[chain];
}

/** What identifies a store: the chain and its branch. `name` only matters for `unknown` chains. */
export interface StoreSpec {
  chain: Chain;
  name?: string;
  branchCode?: string;
  city?: string;
}

const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const key = (value: string | undefined): string => (clean(value) ?? '').toLocaleLowerCase('ro');

/** `Kaufland Cluj-Napoca`; for an unknown chain the printed name, else `Alt magazin`. */
export function storeNameFor(spec: StoreSpec): string {
  if (spec.chain === 'unknown') return clean(spec.name) ?? CHAIN_LABELS.unknown;
  const city = clean(spec.city);
  return city ? `${CHAIN_LABELS[spec.chain]} ${city}` : CHAIN_LABELS[spec.chain];
}

export function matchesStoreSpec(store: Store, spec: StoreSpec): boolean {
  return (
    store.chain === spec.chain &&
    key(store.branchCode) === key(spec.branchCode) &&
    key(store.city) === key(spec.city) &&
    (spec.chain !== 'unknown' || key(store.name) === key(storeNameFor(spec)))
  );
}

/** The live store of that chain and branch, if one exists. The oldest wins when there are several. */
export async function findStore(db: PretometruDB, spec: StoreSpec): Promise<Store | undefined> {
  const candidates = await db.stores
    .where('chain')
    .equals(spec.chain)
    .filter((store) => store.deletedAt === undefined && matchesStoreSpec(store, spec))
    .toArray();
  return candidates.sort((a, b) => a.id.localeCompare(b.id))[0];
}

/** Finds the store for a chain and branch or creates it; one transaction, so imports cannot race. */
export function findOrCreateStore(
  db: PretometruDB,
  spec: StoreSpec,
  context?: StorageContext,
): Promise<Store> {
  return db.transaction('rw', db.stores, async () => {
    const existing = await findStore(db, spec);
    if (existing) return existing;

    const branchCode = clean(spec.branchCode);
    const city = clean(spec.city);
    return createRecord(
      db.stores,
      {
        chain: spec.chain,
        name: storeNameFor(spec),
        ...(branchCode ? { branchCode } : {}),
        ...(city ? { city } : {}),
      },
      context,
    );
  });
}
