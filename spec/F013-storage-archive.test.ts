// The contract these tests hold the storage block's archive to, on top of the store described in
// spec/F012-storage-block.test.ts:
// - A Store also has:
//   - exportArchive(): writes every record (with its collection and its place in the order), every
//     setting and every file into one archive file on the device, and resolves that file's file:// URI.
//   - importArchive(uri): reads the archive at uri into this store and resolves { added, skipped }:
//     added the number of records written, skipped the number of records left out because a record
//     with the same id was already in the same collection. A skipped record keeps the store's own
//     version. Settings and files in the archive are restored along with the records.
//   - When the file at uri is not an archive made by exportArchive (any other file, or an archive cut
//     short), importArchive resolves { error: "not-an-archive" } and writes nothing.
// - The archive is a plain file: it may be copied to another device, and importArchive reads it from
//   wherever it was copied to.

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Doc = { id: string; [key: string]: Json };
type Failure = { error: string };
type Counts = { added: number; skipped: number };
type Store = {
  save: (collection: string, record: Doc) => Promise<void | Failure | unknown>;
  get: (collection: string, id: string) => Promise<Doc | null>;
  list: (collection: string) => Promise<Doc[]>;
  remove: (collection: string, id: string) => Promise<void | unknown>;
  setSetting: (key: string, value: Json) => Promise<void | Failure | unknown>;
  getSetting: <T extends Json>(key: string, fallback: T) => Promise<T>;
  saveFile: (name: string, bytes: Uint8Array) => Promise<void | Failure | unknown>;
  deleteFile: (name: string) => Promise<void | unknown>;
  listFiles: () => Promise<{ name: string; size: number }[]>;
  usedBytes: () => Promise<number>;
  close: () => Promise<void>;
  exportArchive: () => Promise<string>;
  importArchive: (uri: string) => Promise<Counts | Failure>;
};
type StorageBlock = { open: (options?: { minFreeBytes?: number }) => Promise<Store> };

// Named mock… so jest.mock factories may use them.

// The phone's disk: file uri → contents, directories that were created, and its capacity in bytes.
const mockDisk = {
  files: new Map<string, Uint8Array>(),
  dirs: new Set<string>(),
  capacity: 64_000_000_000,
};

function mockNormalize(uri: string): string {
  return uri.replace(/([^:/])\/{2,}/g, '$1/').replace(/\/+$/, '');
}
function mockUnder(dir: string, uri: string): boolean {
  return uri.startsWith(`${mockNormalize(dir)}/`);
}
function mockDirExists(uri: string): boolean {
  const dir = mockNormalize(uri);
  return mockDisk.dirs.has(dir) || [...mockDisk.files.keys()].some((f) => mockUnder(dir, f)) || /^file:\/\/\/(document|cache)$/.test(dir);
}
function mockUsed(): number {
  let total = 0;
  for (const bytes of mockDisk.files.values()) total += bytes.length;
  return total;
}
function mockFree(): number {
  return mockDisk.capacity - mockUsed();
}
function mockDirSize(uri: string): number {
  let total = 0;
  for (const [f, bytes] of mockDisk.files) if (mockUnder(uri, f)) total += bytes.length;
  return total;
}
function mockDelete(uri: string): void {
  const target = mockNormalize(uri);
  mockDisk.files.delete(target);
  for (const f of [...mockDisk.files.keys()]) if (mockUnder(target, f)) mockDisk.files.delete(f);
  for (const d of [...mockDisk.dirs]) if (d === target || mockUnder(target, d)) mockDisk.dirs.delete(d);
}
function mockChildren(uri: string): string[] {
  const dir = mockNormalize(uri);
  const names = new Set<string>();
  for (const p of [...mockDisk.files.keys(), ...mockDisk.dirs]) {
    if (mockUnder(dir, p)) names.add(p.slice(dir.length + 1).split('/')[0] ?? '');
  }
  names.delete('');
  return [...names];
}
function mockWrite(uri: string, bytes: Uint8Array, append = false): void {
  const target = mockNormalize(uri);
  const before = append ? (mockDisk.files.get(target) ?? new Uint8Array(0)) : new Uint8Array(0);
  const grows = before.length + bytes.length - (mockDisk.files.get(target)?.length ?? 0);
  if (grows > mockFree()) throw new Error('No space left on device');
  const next = new Uint8Array(before.length + bytes.length);
  next.set(before, 0);
  next.set(bytes, before.length);
  mockDisk.files.set(target, next);
}
function mockEncode(content: string | Uint8Array, encoding?: string): Uint8Array {
  if (typeof content !== 'string') return new Uint8Array(content);
  return new Uint8Array(Buffer.from(content, encoding === 'base64' ? 'base64' : 'utf8'));
}
function mockRead(uri: string): Uint8Array {
  const bytes = mockDisk.files.get(mockNormalize(uri));
  if (!bytes) throw new Error(`No file at ${uri}`);
  return bytes;
}
function mockMove(from: string, to: string, keep: boolean): void {
  const source = mockNormalize(from);
  const target = mockNormalize(to);
  if (mockDisk.files.has(source)) {
    const bytes = mockDisk.files.get(source)!;
    if (keep && bytes.length > mockFree()) throw new Error('No space left on device');
    mockDisk.files.set(target, new Uint8Array(bytes));
    if (!keep) mockDisk.files.delete(source);
    return;
  }
  for (const f of [...mockDisk.files.keys()]) {
    if (!mockUnder(source, f)) continue;
    mockDisk.files.set(target + f.slice(source.length), new Uint8Array(mockDisk.files.get(f)!));
    if (!keep) mockDisk.files.delete(f);
  }
  mockDisk.dirs.add(target);
  if (!keep) mockDelete(source);
}

jest.mock(
  'expo-file-system',
  () => {
    const join = (parts: unknown[]) =>
      mockNormalize(parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/'));
    const uriOf = (target: unknown) => (typeof target === 'string' ? target : (target as { uri: string }).uri);
    class File {
      uri: string;
      constructor(...parts: unknown[]) {
        this.uri = join(parts);
      }
      get name() {
        return this.uri.split('/').pop() ?? '';
      }
      get extension() {
        const dot = this.name.lastIndexOf('.');
        return dot < 0 ? '' : this.name.slice(dot);
      }
      get parentDirectory() {
        return new Directory(this.uri.slice(0, this.uri.lastIndexOf('/')));
      }
      get exists() {
        return mockDisk.files.has(this.uri);
      }
      get size() {
        return mockDisk.files.get(this.uri)?.length ?? 0;
      }
      info() {
        return { exists: this.exists, size: this.size, uri: this.uri };
      }
      create(options?: { overwrite?: boolean }) {
        if (this.exists && !options?.overwrite) throw new Error(`A file exists at ${this.uri}`);
        mockWrite(this.uri, new Uint8Array(0));
      }
      write(content: string | Uint8Array, options?: { encoding?: string; append?: boolean }) {
        mockWrite(this.uri, mockEncode(content, options?.encoding), options?.append);
      }
      textSync() {
        return Buffer.from(mockRead(this.uri)).toString('utf8');
      }
      async text() {
        return this.textSync();
      }
      base64Sync() {
        return Buffer.from(mockRead(this.uri)).toString('base64');
      }
      async base64() {
        return this.base64Sync();
      }
      bytesSync() {
        return new Uint8Array(mockRead(this.uri));
      }
      async bytes() {
        return this.bytesSync();
      }
      delete() {
        if (!this.exists) throw new Error(`No file at ${this.uri}`);
        mockDelete(this.uri);
      }
      move(destination: unknown) {
        const target = mockDirExists(uriOf(destination)) ? `${uriOf(destination)}/${this.name}` : uriOf(destination);
        mockMove(this.uri, target, false);
        this.uri = mockNormalize(target);
      }
      copy(destination: unknown) {
        const target = mockDirExists(uriOf(destination)) ? `${uriOf(destination)}/${this.name}` : uriOf(destination);
        mockMove(this.uri, target, true);
      }
      rename(name: string) {
        this.move(`${this.uri.slice(0, this.uri.lastIndexOf('/'))}/${name}`);
      }
    }
    class Directory {
      uri: string;
      constructor(...parts: unknown[]) {
        this.uri = join(parts);
      }
      get name() {
        return this.uri.split('/').pop() ?? '';
      }
      get exists() {
        return mockDirExists(this.uri);
      }
      get size() {
        return mockDirSize(this.uri);
      }
      info() {
        return { exists: this.exists, size: this.size, uri: this.uri };
      }
      create(options?: { idempotent?: boolean; intermediates?: boolean }) {
        if (this.exists && options?.idempotent === false) throw new Error(`A directory exists at ${this.uri}`);
        mockDisk.dirs.add(this.uri);
      }
      delete() {
        mockDelete(this.uri);
      }
      list() {
        return mockChildren(this.uri).map((name) => {
          const uri = `${this.uri}/${name}`;
          return mockDisk.files.has(uri) ? new File(uri) : new Directory(uri);
        });
      }
      createFile(name: string) {
        const file = new File(this.uri, name);
        file.create();
        return file;
      }
      createDirectory(name: string) {
        const dir = new Directory(this.uri, name);
        dir.create();
        return dir;
      }
    }
    class Paths {
      static get document() {
        return new Directory('file:///document');
      }
      static get cache() {
        return new Directory('file:///cache');
      }
      static get availableDiskSpace() {
        return mockFree();
      }
      static get totalDiskSpace() {
        return mockDisk.capacity;
      }
      static join(...parts: unknown[]) {
        return join(parts);
      }
      static info(uri: string) {
        const target = mockNormalize(uri);
        return { exists: mockDisk.files.has(target) || mockDirExists(target), isDirectory: mockDirExists(target) };
      }
    }
    return { File, Directory, Paths };
  },
  { virtual: true },
);

jest.mock(
  'expo-file-system/legacy',
  () => ({
    documentDirectory: 'file:///document/',
    cacheDirectory: 'file:///cache/',
    EncodingType: { UTF8: 'utf8', Base64: 'base64' },
    getInfoAsync: async (uri: string) => {
      const target = mockNormalize(uri);
      if (mockDisk.files.has(target)) return { exists: true, isDirectory: false, size: mockDisk.files.get(target)!.length, uri };
      if (mockDirExists(target)) return { exists: true, isDirectory: true, size: mockDirSize(target), uri };
      return { exists: false, isDirectory: false, uri };
    },
    readDirectoryAsync: async (uri: string) => mockChildren(uri),
    makeDirectoryAsync: async (uri: string) => {
      mockDisk.dirs.add(mockNormalize(uri));
    },
    writeAsStringAsync: async (uri: string, content: string, options?: { encoding?: string; append?: boolean }) => {
      mockWrite(uri, mockEncode(content, options?.encoding), options?.append);
    },
    readAsStringAsync: async (uri: string, options?: { encoding?: string }) =>
      Buffer.from(mockRead(uri)).toString(options?.encoding === 'base64' ? 'base64' : 'utf8'),
    deleteAsync: async (uri: string, options?: { idempotent?: boolean }) => {
      const target = mockNormalize(uri);
      if (!mockDisk.files.has(target) && !mockDirExists(target) && !options?.idempotent) throw new Error(`Nothing at ${uri}`);
      mockDelete(target);
    },
    moveAsync: async ({ from, to }: { from: string; to: string }) => mockMove(from, to, false),
    copyAsync: async ({ from, to }: { from: string; to: string }) => mockMove(from, to, true),
    getFreeDiskStorageAsync: async () => mockFree(),
    getTotalDiskCapacityAsync: async () => mockDisk.capacity,
  }),
  { virtual: true },
);

// A fresh start of the app: modules load again, the disk stays.
async function open(options?: { minFreeBytes?: number }): Promise<Store> {
  jest.resetModules();
  const block = require('../src/blocks/storage/index') as StorageBlock;
  return block.open(options);
}

async function reopen(store: Store): Promise<Store> {
  await store.close();
  return open();
}

// Bytes that differ from file to file and from position to position, so a restored file can be told apart.
function pattern(size: number, seed: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (i * 31 + seed * 17 + ((i >> 8) ^ seed)) & 0xff;
  return out;
}

function onDisk(bytes: Uint8Array): boolean {
  return [...mockDisk.files.values()].some((f) => f.length === bytes.length && Buffer.from(f).equals(Buffer.from(bytes)));
}

function snapshot(): { files: [string, string][]; dirs: string[] } {
  return {
    files: [...mockDisk.files].map(([uri, content]) => [uri, Buffer.from(content).toString('base64')] as [string, string]).sort(),
    dirs: [...mockDisk.dirs].sort(),
  };
}

function sized(files: { name: string; size: number }[]): [string, number][] {
  return files.map((f) => [f.name, f.size] as [string, number]).sort();
}

// Copies a file to a new phone: everything else on the disk is gone, and the file lands where a picker would put it.
function moveToNewPhone(uri: string): string {
  const bytes = new Uint8Array(mockRead(uri));
  mockDisk.files.clear();
  mockDisk.dirs.clear();
  const name = mockNormalize(uri).split('/').pop() || 'backup';
  const target = `file:///cache/DocumentPicker/${name}`;
  mockDisk.files.set(target, bytes);
  return target;
}

// Puts a file where a picker would put it and returns its uri.
function drop(content: string | Uint8Array, name: string): string {
  const target = `file:///cache/DocumentPicker/${name}`;
  mockDisk.files.set(target, typeof content === 'string' ? new Uint8Array(Buffer.from(content, 'utf8')) : content);
  return target;
}

const docs: Doc[] = [
  { id: 'd3', title: 'Lease agreement', pages: 3, tags: ['home', 'legal'], signed: false },
  { id: 'd1', title: 'Tax return 2025', pages: 12, owner: { name: 'Heather', shared: true }, note: null },
  { id: 'd2', title: 'Vet invoice — Desi', pages: 1, total: 412.5 },
];
const notes: Doc[] = [{ id: 'd1', text: 'Same id as a doc, different collection' }];
const scans = [
  { name: 'page-1.jpg', bytes: pattern(3_000, 1) },
  { name: 'page-2.jpg', bytes: pattern(5_500, 2) },
  { name: 'receipt.png', bytes: pattern(1_234, 3) },
];

async function fill(store: Store): Promise<void> {
  for (const d of docs) await store.save('docs', d);
  for (const n of notes) await store.save('notes', n);
  await store.setSetting('sort', 'name');
  await store.setSetting('pageSize', 50);
  await store.setSetting('filters', { tags: ['legal'], signed: false });
  for (const s of scans) await store.saveFile(s.name, s.bytes);
}

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_USE_FAKES;
  mockDisk.files.clear();
  mockDisk.dirs.clear();
  mockDisk.capacity = 64_000_000_000;
});

describe('F013 storage archive', () => {
  it('importArchive of an exportArchive file restores every record, setting and file; into a store that has records it skips ids already present and returns the added and skipped counts; a file that is not an archive returns "not-an-archive" and changes nothing.', async () => {
    // --- Restores every record, setting and file on a new phone. ---
    let store = await open();
    await fill(store);
    const files = sized(await store.listFiles());
    const archive = await store.exportArchive();
    expect(typeof archive).toBe('string');
    expect(archive).toMatch(/^file:\/\//);
    expect(mockDisk.files.has(mockNormalize(archive))).toBe(true);
    await store.close();

    const copied = moveToNewPhone(archive);
    const archiveBytes = new Uint8Array(mockRead(copied));
    store = await open();
    expect(await store.list('docs')).toEqual([]);
    expect(await store.importArchive(copied)).toEqual({ added: docs.length + notes.length, skipped: 0 });

    const checkRestored = async (s: Store) => {
      expect(await s.list('docs')).toEqual(docs);
      expect(await s.list('notes')).toEqual(notes);
      for (const d of docs) expect(await s.get('docs', d.id)).toEqual(d);
      expect(await s.getSetting('sort', 'date')).toBe('name');
      expect(await s.getSetting('pageSize', 20)).toBe(50);
      expect(await s.getSetting('filters', null)).toEqual({ tags: ['legal'], signed: false });
      expect(await s.getSetting('theme', 'system')).toBe('system');
      expect(sized(await s.listFiles())).toEqual(files);
      for (const f of scans) expect(onDisk(f.bytes)).toBe(true);
    };
    await checkRestored(store);
    // It stays restored after a restart.
    store = await reopen(store);
    await checkRestored(store);
    await store.close();

    // --- Into a store that has records: skips ids already present, returns the counts. ---
    mockDisk.files.clear();
    mockDisk.dirs.clear();
    mockDisk.files.set(copied, archiveBytes);
    store = await open();
    const local: Doc = { id: 'd1', title: 'My own copy of d1', pages: 99 };
    const mine: Doc = { id: 'm1', title: 'Only on this phone' };
    await store.save('docs', local);
    await store.save('docs', mine);
    // An id present in another collection does not make a doc with that id a duplicate.
    await store.save('receipts', { id: 'd2', amount: 12 });

    expect(await store.importArchive(copied)).toEqual({ added: 3, skipped: 1 });
    const merged = await store.list('docs');
    expect(merged).toHaveLength(4);
    expect(merged).toEqual(expect.arrayContaining([local, mine, docs[0], docs[2]]));
    expect(await store.get('docs', 'd1')).toEqual(local);
    expect(await store.get('docs', 'd2')).toEqual(docs[2]);
    expect(await store.get('docs', 'd3')).toEqual(docs[0]);
    expect(await store.list('notes')).toEqual(notes);
    expect(await store.list('receipts')).toEqual([{ id: 'd2', amount: 12 }]);

    // Importing the same archive again adds nothing and skips every record.
    expect(await store.importArchive(copied)).toEqual({ added: 0, skipped: docs.length + notes.length });
    expect(await store.list('docs')).toHaveLength(4);
    expect(await store.list('notes')).toEqual(notes);

    store = await reopen(store);
    expect(await store.get('docs', 'd1')).toEqual(local);
    expect(await store.list('docs')).toHaveLength(4);
    expect(await store.list('notes')).toEqual(notes);

    // --- A file that is not an archive returns "not-an-archive" and changes nothing. ---
    await store.setSetting('sort', 'date');
    await store.saveFile('mine.jpg', pattern(777, 9));
    const notArchives = [
      drop('Just some notes, not a backup.\n', 'notes.txt'),
      drop(JSON.stringify({ hello: 'world', records: 3 }), 'data.json'),
      drop(pattern(4_096, 42), 'photo.jpg'),
      drop(new Uint8Array(0), 'empty.bin'),
      drop(archiveBytes.slice(0, Math.floor(archiveBytes.length / 2)), 'cut-short-backup'),
    ];
    const docsBefore = await store.list('docs');
    const notesBefore = await store.list('notes');
    const filesBefore = sized(await store.listFiles());
    const used = await store.usedBytes();
    const disk = snapshot();

    for (const uri of notArchives) {
      expect(await store.importArchive(uri)).toEqual({ error: 'not-an-archive' });
      expect(snapshot()).toEqual(disk);
    }
    expect(await store.list('docs')).toEqual(docsBefore);
    expect(await store.list('notes')).toEqual(notesBefore);
    expect(await store.getSetting('sort', 'none')).toBe('date');
    expect(sized(await store.listFiles())).toEqual(filesBefore);
    expect(await store.usedBytes()).toBe(used);

    store = await reopen(store);
    expect(await store.list('docs')).toEqual(docsBefore);
    expect(await store.getSetting('sort', 'none')).toBe('date');
    expect(sized(await store.listFiles())).toEqual(filesBefore);
    await store.close();
  });
});
