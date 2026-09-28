// The contract these tests hold the storage block to:
// - src/blocks/storage/index.ts exports open(options?): Promise<Store>. options.minFreeBytes is the
//   free-space limit the app sets: the least free space, in bytes, a write may leave on the device.
// - A Store has:
//   - save(collection, record): record is JSON with a string id. Saving an id that is already in the
//     collection replaces that record and keeps its place in the order.
//   - get(collection, id): the record, or null when there is none.
//   - list(collection): the collection's records in the order they were first saved.
//   - remove(collection, id).
//   - setSetting(key, value) and getSetting(key, fallback): fallback is returned for a key never written.
//   - saveFile(name, bytes): bytes is a Uint8Array. deleteFile(name). listFiles(): [{ name, size }].
//   - usedBytes(): the bytes the store keeps on the device.
//   - close(): after it resolves, a later open() sees everything that was written.
// - save, setSetting and saveFile resolve { error: "not-enough-space" } and write nothing when the
//   write would leave less free space than minFreeBytes. Leaving exactly minFreeBytes is allowed.
// - Everything is kept on the device with expo-file-system (File / Directory / Paths, or the legacy
//   API). Free space is Paths.availableDiskSpace, or the legacy getFreeDiskStorageAsync().

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Doc = { id: string; [key: string]: Json };
type Failure = { error: string };
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

async function reopen(store: Store, options?: { minFreeBytes?: number }): Promise<Store> {
  await store.close();
  return open(options);
}

function bytes(size: number, fill: number): Uint8Array {
  return new Uint8Array(size).fill(fill);
}

function snapshot(): { files: [string, string][]; dirs: string[] } {
  return {
    files: [...mockDisk.files].map(([uri, content]) => [uri, Buffer.from(content).toString('base64')] as [string, string]).sort(),
    dirs: [...mockDisk.dirs].sort(),
  };
}

function names(files: { name: string }[]): string[] {
  return files.map((f) => f.name).sort();
}

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_USE_FAKES;
  mockDisk.files.clear();
  mockDisk.dirs.clear();
  mockDisk.capacity = 64_000_000_000;
});

describe('F012 storage block', () => {
  it('A record saved with id "d1" in collection "docs" is returned by get and by list after the store is closed and reopened, and after remove it is returned by neither.', async () => {
    const d1: Doc = { id: 'd1', title: 'Lease agreement', pages: 3, tags: ['home', 'legal'], signed: false };
    const other: Doc = { id: 'd1', title: 'A note with the same id in another collection' };

    let store = await open();
    expect(await store.save('docs', d1)).not.toEqual(expect.objectContaining({ error: expect.anything() }));
    await store.save('notes', other);
    expect(await store.get('docs', 'd1')).toEqual(d1);

    store = await reopen(store);
    expect(await store.get('docs', 'd1')).toEqual(d1);
    expect(await store.list('docs')).toEqual([d1]);

    await store.remove('docs', 'd1');
    expect(await store.get('docs', 'd1')).toBeNull();
    expect(await store.list('docs')).toEqual([]);

    // Still gone after another restart, and the other collection is untouched.
    store = await reopen(store);
    expect(await store.get('docs', 'd1')).toBeNull();
    expect(await store.list('docs')).toEqual([]);
    expect(await store.get('notes', 'd1')).toEqual(other);
    await store.close();
  });

  it('list returns a collection\'s records in the order they were first saved.', async () => {
    let store = await open();
    await store.save('docs', { id: 'c', title: 'Zebra' });
    await store.save('docs', { id: 'a', title: 'Mango' });
    await store.save('other', { id: 'x', title: 'Elsewhere' });
    await store.save('docs', { id: 'b', title: 'Apple' });
    // Saving "c" again replaces it but keeps its place.
    await store.save('docs', { id: 'c', title: 'Zebra, revised' });

    const expected = [
      { id: 'c', title: 'Zebra, revised' },
      { id: 'a', title: 'Mango' },
      { id: 'b', title: 'Apple' },
    ];
    expect(await store.list('docs')).toEqual(expected);

    store = await reopen(store);
    expect(await store.list('docs')).toEqual(expected);
    expect(await store.list('other')).toEqual([{ id: 'x', title: 'Elsewhere' }]);
    expect(await store.list('never-used')).toEqual([]);
    await store.close();
  });

  it('A setting written as sort "name" reads back "name" after the store is reopened, and a setting never written reads as the default passed in.', async () => {
    let store = await open();
    expect(await store.getSetting('sort', 'date')).toBe('date');
    await store.setSetting('sort', 'name');
    expect(await store.getSetting('sort', 'date')).toBe('name');

    store = await reopen(store);
    expect(await store.getSetting('sort', 'date')).toBe('name');
    expect(await store.getSetting('theme', 'system')).toBe('system');
    expect(await store.getSetting('pageSize', 20)).toBe(20);
    expect(await store.getSetting('showHidden', false)).toBe(false);
    await store.close();
  });

  it('Saving 3 files and deleting 1 leaves 2, and usedBytes falls by the deleted file\'s size.', async () => {
    let store = await open();
    await store.saveFile('page-1.jpg', bytes(1_000, 1));
    await store.saveFile('page-2.jpg', bytes(2_500, 2));
    await store.saveFile('page-3.jpg', bytes(4_000, 3));
    expect(names(await store.listFiles())).toEqual(['page-1.jpg', 'page-2.jpg', 'page-3.jpg']);

    const before = await store.usedBytes();
    expect(before).toBeGreaterThanOrEqual(7_500);

    await store.deleteFile('page-2.jpg');
    const files = await store.listFiles();
    expect(names(files)).toEqual(['page-1.jpg', 'page-3.jpg']);
    expect(files.find((f) => f.name === 'page-3.jpg')!.size).toBe(4_000);
    expect(await store.usedBytes()).toBe(before - 2_500);

    store = await reopen(store);
    expect(names(await store.listFiles())).toEqual(['page-1.jpg', 'page-3.jpg']);
    expect(await store.usedBytes()).toBe(before - 2_500);
    await store.close();
  });

  it('A write that would leave less free space than the limit the app sets returns the error "not-enough-space" and writes nothing.', async () => {
    const limit = 1_000_000;
    let store = await open({ minFreeBytes: limit });
    await store.save('docs', { id: 'd1', title: 'Lease agreement' });
    await store.setSetting('sort', 'name');
    await store.saveFile('page-1.jpg', bytes(1_000, 1));

    // 1.5 MB free: a 600 KB file would leave 900 KB, below the 1 MB limit.
    mockDisk.capacity = mockUsed() + 1_500_000;
    const used = await store.usedBytes();
    let disk = snapshot();
    expect(await store.saveFile('big.jpg', bytes(600_000, 7))).toEqual({ error: 'not-enough-space' });
    expect(snapshot()).toEqual(disk);
    expect(names(await store.listFiles())).toEqual(['page-1.jpg']);
    expect(await store.usedBytes()).toBe(used);

    // A file that leaves exactly the limit is written.
    expect(await store.saveFile('fits.jpg', bytes(500_000, 8))).not.toEqual(expect.objectContaining({ error: expect.anything() }));
    expect(names(await store.listFiles())).toEqual(['fits.jpg', 'page-1.jpg']);

    // Records and settings are held to the same limit.
    mockDisk.capacity = mockUsed() + limit + 10;
    disk = snapshot();
    const long = 'x'.repeat(5_000);
    expect(await store.save('docs', { id: 'd2', body: long })).toEqual({ error: 'not-enough-space' });
    expect(await store.save('docs', { id: 'd1', title: long })).toEqual({ error: 'not-enough-space' });
    expect(await store.setSetting('sort', long)).toEqual({ error: 'not-enough-space' });
    expect(snapshot()).toEqual(disk);
    expect(await store.get('docs', 'd2')).toBeNull();
    expect(await store.list('docs')).toEqual([{ id: 'd1', title: 'Lease agreement' }]);
    expect(await store.getSetting('sort', 'date')).toBe('name');

    // Nothing half-written shows up after a restart either.
    store = await reopen(store, { minFreeBytes: limit });
    expect(await store.list('docs')).toEqual([{ id: 'd1', title: 'Lease agreement' }]);
    expect(await store.getSetting('sort', 'date')).toBe('name');
    expect(names(await store.listFiles())).toEqual(['fits.jpg', 'page-1.jpg']);
    await store.close();
  });
});
