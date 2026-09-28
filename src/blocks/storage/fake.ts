// In-memory storage block. Stores keep their data across open() and close() for as long as the
// app runs; free space is whatever the test set, less what the fake stores hold.
import { DEFAULT_STORE_NAME, openStore, utf8Length, type Disk, type OpenOptions, type Store } from './store';

const disks = new Map<string, Map<string, string | Uint8Array>>();
let capacity = Number.MAX_SAFE_INTEGER;

function sizeOf(data: string | Uint8Array): number {
  return typeof data === 'string' ? utf8Length(data) : data.byteLength;
}

function usedByAll(): number {
  let total = 0;
  for (const disk of disks.values()) for (const data of disk.values()) total += sizeOf(data);
  return total;
}

function memoryDisk(name: string): Disk {
  let entries = disks.get(name);
  if (!entries) {
    entries = new Map();
    disks.set(name, entries);
  }
  const store = entries;
  return {
    async readText(path) {
      const data = store.get(path);
      return typeof data === 'string' ? data : null;
    },
    async writeText(path, text) {
      store.set(path, text);
    },
    async writeBytes(path, bytes) {
      store.set(path, new Uint8Array(bytes));
    },
    async remove(path) {
      store.delete(path);
    },
    async files(dir) {
      const prefix = `${dir}/`;
      return [...store]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, data]) => ({ name: path.slice(prefix.length), size: sizeOf(data) }));
    },
    async size(path) {
      const data = store.get(path);
      return data === undefined ? 0 : sizeOf(data);
    },
    async used() {
      let total = 0;
      for (const data of store.values()) total += sizeOf(data);
      return total;
    },
    async free() {
      return capacity - usedByAll();
    },
  };
}

// The device's total space as the fake sees it; free space is this less what the stores hold.
export function setFakeCapacity(bytes: number): void {
  capacity = bytes;
}

// Forgets every fake store and puts capacity back.
export function resetFake(): void {
  disks.clear();
  capacity = Number.MAX_SAFE_INTEGER;
}

export async function open(options?: OpenOptions): Promise<Store> {
  return openStore(memoryDisk(options?.name ?? DEFAULT_STORE_NAME), options);
}
