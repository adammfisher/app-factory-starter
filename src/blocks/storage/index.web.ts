// The browser has no file system the page can write to, so the store keeps everything in IndexedDB
// (web-disk.ts). The rules, including the free-space limit, are the same as on the phone.
import { useFakes } from '../../env';
import * as fake from './fake';
import { DEFAULT_STORE_NAME, openStore, type OpenOptions, type Store } from './store';
import { webDisk } from './web-disk';

export { DEFAULT_MIN_FREE_BYTES } from './store';
export type { Doc, Failure, ImportCounts, Json, NotAnArchive, OpenOptions, Store, StoredFile } from './store';

async function webOpen(options?: OpenOptions): Promise<Store> {
  return openStore(webDisk(options?.name ?? DEFAULT_STORE_NAME), options);
}

const fakes = useFakes();

export const open: (options?: OpenOptions) => Promise<Store> = fakes ? fake.open : webOpen;
export const setFakeCapacity = fake.setFakeCapacity;
export const resetFake = fake.resetFake;
