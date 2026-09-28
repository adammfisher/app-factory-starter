// The storage block's disk in the browser: one IndexedDB database per store, one entry per path.
// Free space is the browser's quota for the site less what the site already uses.
import { utf8Length, type Disk, type StoredFile } from './store';

type Entry = { path: string; data: string | Uint8Array; size: number };

const ENTRIES = 'entries';

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(name: string): Promise<IDBDatabase> {
  const request = indexedDB.open(`storage-block:${name}`, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(ENTRIES, { keyPath: 'path' });
  return done(request);
}

export function webDisk(name: string): Disk {
  const database = openDatabase(name);

  async function run<T>(mode: IDBTransactionMode, work: (entries: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await database;
    const tx = db.transaction(ENTRIES, mode);
    const result = done(work(tx.objectStore(ENTRIES)));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return result;
  }

  const entry = (path: string) => run('readonly', (s) => s.get(path) as IDBRequest<Entry | undefined>);
  const all = () => run('readonly', (s) => s.getAll() as IDBRequest<Entry[]>);
  const put = (value: Entry) => run('readwrite', (s) => s.put(value)).then(() => undefined);

  return {
    async readText(path) {
      const found = await entry(path);
      return typeof found?.data === 'string' ? found.data : null;
    },
    writeText: (path, text) => put({ path, data: text, size: utf8Length(text) }),
    writeBytes: (path, bytes) => put({ path, data: new Uint8Array(bytes), size: bytes.byteLength }),
    remove: (path) => run('readwrite', (s) => s.delete(path)).then(() => undefined),
    async files(dir): Promise<StoredFile[]> {
      const prefix = `${dir}/`;
      return (await all())
        .filter((e) => e.path.startsWith(prefix) && !e.path.slice(prefix.length).includes('/'))
        .map((e) => ({ name: e.path.slice(prefix.length), size: e.size }));
    },
    async size(path) {
      return (await entry(path))?.size ?? 0;
    },
    async used() {
      return (await all()).reduce((total, e) => total + e.size, 0);
    },
    async free() {
      const estimate = await navigator.storage?.estimate?.();
      if (!estimate?.quota) return Number.MAX_SAFE_INTEGER;
      return estimate.quota - (estimate.usage ?? 0);
    },
  };
}
