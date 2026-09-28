import { useFakes } from '../../env';
import { fileDisk } from './disk';
import * as fake from './fake';
import { DEFAULT_STORE_NAME, openStore, type OpenOptions, type Store } from './store';

export { DEFAULT_MIN_FREE_BYTES } from './store';
export type { Doc, Failure, Json, OpenOptions, Store, StoredFile } from './store';

async function realOpen(options?: OpenOptions): Promise<Store> {
  return openStore(fileDisk(options?.name ?? DEFAULT_STORE_NAME), options);
}

const fakes = useFakes();

export const open: (options?: OpenOptions) => Promise<Store> = fakes ? fake.open : realOpen;
export const setFakeCapacity = fake.setFakeCapacity;
export const resetFake = fake.resetFake;
