// The storage block's store, written once against a small Disk so the same rules hold on iOS and
// Android (expo-file-system), on the web (IndexedDB) and in the fake (memory).
//
// On the disk, under the store's own folder:
//   records/<collection>.json  the collection's records, as a JSON array in the order first saved
//   settings.json              every setting, as one JSON object
//   files/<name>               each file's bytes
// Names are URI-encoded so any collection or file name is a safe file name.
//
// An archive is one JSON file outside that folder, so it can be shared and copied to another device:
//   { format, version, records: { <collection>: Doc[] }, settings: {...}, files: { <name>: base64 } }
import { fromBase64, toBase64 } from './base64';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type Doc = { id: string; [key: string]: Json };
export type Failure = { error: 'not-enough-space' };
export type NotAnArchive = { error: 'not-an-archive' };
export type StoredFile = { name: string; size: number };
// Records written by an import, and records left out because their id was already in the collection.
export type ImportCounts = { added: number; skipped: number };

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
  // Writes every record, setting and file into one archive file and resolves its URI.
  exportArchive(): Promise<string | Failure>;
  // Adds what the archive holds that this store lacks. Records whose id is already in the collection,
  // settings already set and files already saved keep the store's own version.
  importArchive(uri: string): Promise<ImportCounts | Failure | NotAnArchive>;
  close(): Promise<void>;
};

// Paths are relative to the store's folder and use "/".
export type Disk = {
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array | null>;
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
  // Writes an archive outside the store's folder and returns a URI it can be shared from.
  writeArchive(text: string): Promise<string>;
  // The text of the file at uri, or null when it cannot be read.
  readArchive(uri: string): Promise<string | null>;
};

// The owner's default: keep 100 MB free unless the app sets its own limit.
export const DEFAULT_MIN_FREE_BYTES = 100 * 1024 * 1024;
export const DEFAULT_STORE_NAME = 'storage';

const NOT_ENOUGH_SPACE: Failure = { error: 'not-enough-space' };
const NOT_AN_ARCHIVE: NotAnArchive = { error: 'not-an-archive' };
const SETTINGS = 'settings.json';
const ARCHIVE_FORMAT = 'app-factory-storage-archive';
const ARCHIVE_VERSION = 1;

type Archive = {
  format: typeof ARCHIVE_FORMAT;
  version: typeof ARCHIVE_VERSION;
  records: Record<string, Doc[]>;
  settings: Record<string, Json>;
  files: Record<string, string>;
};

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The archive the text holds, with its files decoded, or null when it is not a whole archive.
function parseArchive(text: string | null): { archive: Archive; files: Map<string, Uint8Array> } | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(value) || value.format !== ARCHIVE_FORMAT || value.version !== ARCHIVE_VERSION) return null;
  const { records, settings, files } = value;
  if (!isObject(records) || !isObject(settings) || !isObject(files)) return null;
  for (const docs of Object.values(records)) {
    if (!Array.isArray(docs) || !docs.every((d) => isObject(d) && typeof d.id === 'string')) return null;
  }
  const decoded = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(files)) {
    const bytes = typeof data === 'string' ? fromBase64(data) : null;
    if (!bytes) return null;
    decoded.set(name, bytes);
  }
  return { archive: value as Archive, files: decoded };
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

  async function collectionNames(): Promise<string[]> {
    const names = new Set(collections.keys());
    for (const f of await disk.files('records')) {
      if (f.name.endsWith('.json')) names.add(decodeURIComponent(f.name.slice(0, -'.json'.length)));
    }
    return [...names];
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

    async exportArchive() {
      assertOpen();
      const archive: Archive = { format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, records: {}, settings, files: {} };
      for (const collection of await collectionNames()) {
        const docs = await records(collection);
        if (docs.length > 0) archive.records[collection] = docs;
      }
      for (const f of await disk.files('files')) {
        const bytes = await disk.readBytes(`files/${f.name}`);
        if (bytes) archive.files[decodeURIComponent(f.name)] = toBase64(bytes);
      }
      const text = JSON.stringify(archive);
      if ((await disk.free()) - utf8Length(text) < minFreeBytes) return NOT_ENOUGH_SPACE;
      return disk.writeArchive(text);
    },

    // Works out every write before making one, so a file that is not an archive, or an import that
    // would not fit, changes nothing.
    async importArchive(uri) {
      assertOpen();
      const parsed = parseArchive(await disk.readArchive(uri));
      if (!parsed) return NOT_AN_ARCHIVE;
      const { archive, files } = parsed;

      let added = 0;
      let skipped = 0;
      let growth = 0;
      const recordWrites: { collection: string; next: Doc[]; text: string }[] = [];
      for (const [collection, incoming] of Object.entries(archive.records)) {
        const docs = await records(collection);
        const ids = new Set(docs.map((d) => d.id));
        const fresh: Doc[] = [];
        for (const doc of incoming) {
          if (ids.has(doc.id)) {
            skipped++;
            continue;
          }
          ids.add(doc.id);
          fresh.push(copy(doc));
        }
        if (fresh.length === 0) continue;
        added += fresh.length;
        const next = [...docs, ...fresh];
        const text = JSON.stringify(next);
        growth += utf8Length(text) - (await disk.size(recordsPath(collection)));
        recordWrites.push({ collection, next, text });
      }

      const has = (key: string) => Object.prototype.hasOwnProperty.call(settings, key);
      const missing = Object.entries(archive.settings).filter(([key]) => !has(key));
      const nextSettings = missing.length > 0 ? { ...settings, ...Object.fromEntries(missing) } : null;
      const settingsText = nextSettings ? JSON.stringify(nextSettings) : '';
      if (nextSettings) growth += utf8Length(settingsText) - (await disk.size(SETTINGS));

      const present = new Set((await disk.files('files')).map((f) => decodeURIComponent(f.name)));
      const fileWrites = [...files].filter(([name]) => !present.has(name));
      for (const [, bytes] of fileWrites) growth += bytes.byteLength;

      if (growth > 0 && (await disk.free()) - growth < minFreeBytes) return NOT_ENOUGH_SPACE;

      for (const { collection, next, text } of recordWrites) {
        await disk.writeText(recordsPath(collection), text);
        collections.set(collection, next);
      }
      if (nextSettings) {
        await disk.writeText(SETTINGS, settingsText);
        settings = nextSettings;
      }
      for (const [name, bytes] of fileWrites) await disk.writeBytes(filePath(name), bytes);
      return { added, skipped };
    },

    // Every write reaches the disk before it resolves, so closing only lets go of what was read.
    async close() {
      closed = true;
      collections.clear();
    },
  };
}
