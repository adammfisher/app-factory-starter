// The storage block's store, written once against a small Disk so the same rules hold on iOS and
// Android (expo-file-system), on the web (IndexedDB) and in the fake (memory).
//
// On the disk, under the store's own folder:
//   records/<collection>.json  the collection's records, as a JSON array in the order first saved
//   settings.json              every setting, as one JSON object
//   files/<name>               each file's bytes
// Names are URI-encoded so any collection or file name is a safe file name.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type Doc = { id: string; [key: string]: Json };
export type Failure = { error: 'not-enough-space' };
export type StoredFile = { name: string; size: number };

export type OpenOptions = {
  // The least free space, in bytes, a write may leave on the device.
  minFreeBytes?: number;
  // The store's folder. Stores with different names never see each other's data.
  name?: string;
};

export type Store = {
  save(collection: string, record: Doc): Promise<void | Failure>;
  get(collection: string, id: string): Promise<Doc | null>;
  list(collection: string): Promise<Doc[]>;
  remove(collection: string, id: string): Promise<void>;
  setSetting(key: string, value: Json): Promise<void | Failure>;
  getSetting<T extends Json>(key: string, fallback: T): Promise<T>;
  saveFile(name: string, bytes: Uint8Array): Promise<void | Failure>;
  deleteFile(name: string): Promise<void>;
  listFiles(): Promise<StoredFile[]>;
  usedBytes(): Promise<number>;
  close(): Promise<void>;
};

// Paths are relative to the store's folder and use "/".
export type Disk = {
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  // The files directly inside a folder, with their sizes in bytes.
  files(dir: string): Promise<StoredFile[]>;
  // A file's size in bytes, or 0 when there is none.
  size(path: string): Promise<number>;
  // Bytes kept under the store's folder.
  used(): Promise<number>;
  // Free space left on the device, in bytes.
  free(): Promise<number>;
};

// The owner's default: keep 100 MB free unless the app sets its own limit.
export const DEFAULT_MIN_FREE_BYTES = 100 * 1024 * 1024;
export const DEFAULT_STORE_NAME = 'storage';

const NOT_ENOUGH_SPACE: Failure = { error: 'not-enough-space' };
const SETTINGS = 'settings.json';

// Bytes the text takes as UTF-8, without TextEncoder, which not every engine the app runs on has.
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function recordsPath(collection: string): string {
  return `records/${encodeURIComponent(collection)}.json`;
}

function filePath(name: string): string {
  return `files/${encodeURIComponent(name)}`;
}

function copy<T extends Json>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function openStore(disk: Disk, options?: OpenOptions): Promise<Store> {
  const minFreeBytes = options?.minFreeBytes ?? DEFAULT_MIN_FREE_BYTES;
  const collections = new Map<string, Doc[]>();
  let settings: Record<string, Json> = JSON.parse((await disk.readText(SETTINGS)) ?? '{}');
  let closed = false;

  function assertOpen(): void {
    if (closed) throw new Error('The store is closed');
  }

  // Whether writing size bytes at path leaves at least minFreeBytes free.
  async function fits(path: string, size: number): Promise<boolean> {
    const growth = size - (await disk.size(path));
    if (growth <= 0) return true;
    return (await disk.free()) - growth >= minFreeBytes;
  }

  async function records(collection: string): Promise<Doc[]> {
    let docs = collections.get(collection);
    if (!docs) {
      docs = JSON.parse((await disk.readText(recordsPath(collection))) ?? '[]') as Doc[];
      collections.set(collection, docs);
    }
    return docs;
  }

  return {
    async save(collection, record) {
      assertOpen();
      const docs = await records(collection);
      const saved = copy(record);
      const at = docs.findIndex((d) => d.id === record.id);
      const next = at < 0 ? [...docs, saved] : docs.map((d, i) => (i === at ? saved : d));
      const text = JSON.stringify(next);
      const path = recordsPath(collection);
      if (!(await fits(path, utf8Length(text)))) return NOT_ENOUGH_SPACE;
      await disk.writeText(path, text);
      collections.set(collection, next);
    },

    async get(collection, id) {
      assertOpen();
      const found = (await records(collection)).find((d) => d.id === id);
      return found ? copy(found) : null;
    },

    async list(collection) {
      assertOpen();
      return copy(await records(collection));
    },

    async remove(collection, id) {
      assertOpen();
      const docs = await records(collection);
      const next = docs.filter((d) => d.id !== id);
      if (next.length === docs.length) return;
      const path = recordsPath(collection);
      if (next.length === 0) await disk.remove(path);
      else await disk.writeText(path, JSON.stringify(next));
      collections.set(collection, next);
    },

    async setSetting(key, value) {
      assertOpen();
      const next = { ...settings, [key]: copy(value) };
      const text = JSON.stringify(next);
      if (!(await fits(SETTINGS, utf8Length(text)))) return NOT_ENOUGH_SPACE;
      await disk.writeText(SETTINGS, text);
      settings = next;
    },

    async getSetting<T extends Json>(key: string, fallback: T): Promise<T> {
      assertOpen();
      return Object.prototype.hasOwnProperty.call(settings, key) ? copy(settings[key] as T) : fallback;
    },

    async saveFile(name, bytes) {
      assertOpen();
      const path = filePath(name);
      if (!(await fits(path, bytes.byteLength))) return NOT_ENOUGH_SPACE;
      await disk.writeBytes(path, bytes);
    },

    async deleteFile(name) {
      assertOpen();
      await disk.remove(filePath(name));
    },

    async listFiles() {
      assertOpen();
      return (await disk.files('files')).map((f) => ({ name: decodeURIComponent(f.name), size: f.size }));
    },

    async usedBytes() {
      assertOpen();
      return disk.used();
    },

    // Every write reaches the disk before it resolves, so closing only lets go of what was read.
    async close() {
      closed = true;
      collections.clear();
    },
  };
}
