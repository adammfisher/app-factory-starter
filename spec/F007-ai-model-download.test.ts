// The contract these tests hold the AI block's model download to (on top of F006's):
// - src/blocks/ai/index.ts also exports:
//   - download(onUpdate?): resolves "not-needed", "not-supported", "downloaded", or { error: "<code>" }.
//     onUpdate receives the progress as a whole percent (a number), or the string "waiting-for-wifi".
//   - cancelDownload(): stops a download in progress; that download resolves { error: "cancelled" }.
//   - remove(): deletes the model files and resolves the number of bytes freed.
// - The model comes from the store-hosted asset pack (Apple-hosted asset packs, Google Play AI packs),
//   reached through requireOptionalNativeModule("AiModelPack") from expo-modules-core. The module has:
//   - getSizeAsync(): Promise<number>, the pack's total size in bytes.
//   - fetchAsync(directoryUri): Promise<void>, which puts the pack's files (one or two .gguf files)
//     into directoryUri, a directory the block chooses, and resolves when they are complete. It
//     rejects when the download fails or is cancelled, and may leave partial files behind.
//   - cancelAsync(): Promise<void>, which makes the running fetchAsync reject.
//   - showCellularDataConfirmationAsync(): Promise<boolean>, the phone's mobile-data prompt; true
//     when the person accepts.
//   - addListener("onProgress", listener) → { remove() }; the listener receives
//     { bytesWritten, totalBytes }.
// - The network type comes from expo-network: getNetworkStateAsync() and
//   addNetworkStateListener(listener) → { remove() }, with type NetworkStateType.WIFI or CELLULAR.
// - Model files are found and deleted with expo-file-system (File / Directory, or the legacy API).
// - A size larger than 200 MB means more than 200,000,000 bytes; these tests use 150 MB and 2 GB.

type Status = 'builtin' | 'downloaded' | 'downloadable' | 'unavailable';
type Update = number | 'waiting-for-wifi';
type DownloadResult = 'not-needed' | 'not-supported' | 'downloaded' | { error: string };
type AiBlock = {
  status: () => Status | Promise<Status>;
  download: (onUpdate?: (update: Update) => void) => Promise<DownloadResult>;
  cancelDownload: () => void | Promise<void>;
  remove: () => Promise<number>;
};
type Builtin = 'missing' | 'off' | 'on';
type NetworkType = 'WIFI' | 'CELLULAR';
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void };

const GiB = 1024 ** 3;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Named mock… so jest.mock factories may use them.

// The phone's storage: file uri → size in bytes, plus directories that were created.
const mockDisk = {
  files: new Map<string, number>(),
  dirs: new Set<string>(),
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
function mockDirSize(uri: string): number {
  let total = 0;
  for (const [f, size] of mockDisk.files) if (mockUnder(uri, f)) total += size;
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

const mockPhone = {
  builtin: 'off' as Builtin,
  totalMemory: (8 * GiB) as number | null,
  network: 'WIFI' as NetworkType,
};

type Fetch = { dir: string; done: Deferred<void> };
const mockPack = {
  files: [
    { name: 'model-00001-of-00002.gguf', size: 1_200_000_000 },
    { name: 'model-00002-of-00002.gguf', size: 800_000_000 },
  ],
  fetches: [] as Fetch[],
  progressListeners: new Set<(event: { bytesWritten: number; totalBytes: number }) => void>(),
  prompt: deferred<boolean>(),
};

function mockPackTotal(): number {
  return mockPack.files.reduce((sum, f) => sum + f.size, 0);
}

const mockPackModule = {
  getSizeAsync: jest.fn(async () => mockPackTotal()),
  fetchAsync: jest.fn((directoryUri: string) => {
    const fetch: Fetch = { dir: mockNormalize(directoryUri), done: deferred<void>() };
    mockPack.fetches.push(fetch);
    return fetch.done.promise;
  }),
  cancelAsync: jest.fn(async () => {
    const running = mockPack.fetches[mockPack.fetches.length - 1];
    running?.done.reject(new Error('Download cancelled'));
  }),
  showCellularDataConfirmationAsync: jest.fn(() => mockPack.prompt.promise),
  addListener: jest.fn((eventName: string, listener: (event: { bytesWritten: number; totalBytes: number }) => void) => {
    if (eventName === 'onProgress') mockPack.progressListeners.add(listener);
    return { remove: () => mockPack.progressListeners.delete(listener) };
  }),
  removeListeners: jest.fn(),
};

const mockNetworkListeners = new Set<(state: { type: NetworkType; isConnected: boolean; isInternetReachable: boolean }) => void>();

jest.mock('expo-modules-core', () => {
  let actual: Record<string, unknown> = {};
  try {
    actual = jest.requireActual('expo-modules-core');
  } catch {
    // Not installed; the block only needs requireOptionalNativeModule.
  }
  const original = actual.requireOptionalNativeModule as Function | undefined;
  return {
    ...actual,
    requireOptionalNativeModule: (moduleName: string) => {
      if (moduleName === 'AiBuiltin')
        return mockPhone.builtin === 'missing'
          ? null
          : { isAvailableAsync: async () => mockPhone.builtin === 'on', generateAsync: async () => 'model text' };
      if (moduleName === 'AiModelPack') return mockPackModule;
      return original ? original(moduleName) : null;
    },
  };
});

jest.mock(
  'llama.rn',
  () => ({
    initLlama: async () => ({
      completion: async () => ({ text: 'model text', content: 'model text' }),
      stopCompletion: async () => undefined,
      release: async () => undefined,
    }),
    releaseAllLlama: async () => undefined,
  }),
  { virtual: true },
);

jest.mock(
  'expo-device',
  () => ({
    get totalMemory() {
      return mockPhone.totalMemory;
    },
    isDevice: true,
  }),
  { virtual: true },
);

jest.mock(
  'expo-network',
  () => {
    const state = () => ({ type: mockPhone.network, isConnected: true, isInternetReachable: true });
    return {
      NetworkStateType: { NONE: 'NONE', UNKNOWN: 'UNKNOWN', CELLULAR: 'CELLULAR', WIFI: 'WIFI', ETHERNET: 'ETHERNET', OTHER: 'OTHER' },
      getNetworkStateAsync: async () => state(),
      addNetworkStateListener: (listener: (s: ReturnType<typeof state>) => void) => {
        mockNetworkListeners.add(listener);
        return { remove: () => mockNetworkListeners.delete(listener) };
      },
    };
  },
  { virtual: true },
);

jest.mock(
  'expo-file-system',
  () => {
    const join = (parts: unknown[]) =>
      mockNormalize(parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/'));
    class File {
      uri: string;
      constructor(...parts: unknown[]) {
        this.uri = join(parts);
      }
      get name() {
        return this.uri.split('/').pop() ?? '';
      }
      get exists() {
        return mockDisk.files.has(this.uri);
      }
      get size() {
        return mockDisk.files.get(this.uri) ?? 0;
      }
      info() {
        return { exists: this.exists, size: this.size, uri: this.uri };
      }
      delete() {
        if (!mockDisk.files.has(this.uri)) throw new Error(`No file at ${this.uri}`);
        mockDelete(this.uri);
      }
      static downloadFileAsync = jest.fn(async () => {
        throw new Error('The model comes from the store-hosted asset pack');
      });
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
      create() {
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
    }
    return {
      File,
      Directory,
      Paths: { document: new Directory('file:///document'), cache: new Directory('file:///cache') },
    };
  },
  { virtual: true },
);

jest.mock(
  'expo-file-system/legacy',
  () => ({
    documentDirectory: 'file:///document/',
    cacheDirectory: 'file:///cache/',
    getInfoAsync: async (uri: string) => {
      const target = mockNormalize(uri);
      if (mockDisk.files.has(target)) return { exists: true, isDirectory: false, size: mockDisk.files.get(target), uri };
      if (mockDirExists(target)) return { exists: true, isDirectory: true, size: mockDirSize(target), uri };
      return { exists: false, isDirectory: false, uri };
    },
    readDirectoryAsync: async (uri: string) => mockChildren(uri),
    makeDirectoryAsync: async (uri: string) => {
      mockDisk.dirs.add(mockNormalize(uri));
    },
    deleteAsync: async (uri: string, options?: { idempotent?: boolean }) => {
      const target = mockNormalize(uri);
      if (!mockDisk.files.has(target) && !mockDirExists(target) && !options?.idempotent) throw new Error(`Nothing at ${uri}`);
      mockDelete(target);
    },
    downloadAsync: jest.fn(async () => {
      throw new Error('The model comes from the store-hosted asset pack');
    }),
    createDownloadResumable: jest.fn(() => {
      throw new Error('The model comes from the store-hosted asset pack');
    }),
  }),
  { virtual: true },
);

function phone(options: { builtin?: Builtin; totalMemory?: number | null; network?: NetworkType }): void {
  mockPhone.builtin = options.builtin ?? 'off';
  mockPhone.totalMemory = options.totalMemory === undefined ? 8 * GiB : options.totalMemory;
  mockPhone.network = options.network ?? 'WIFI';
}

function load(): AiBlock {
  jest.resetModules();
  return require('../src/blocks/ai/index') as AiBlock;
}

// Lets pending promises and zero-delay timers run.
async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

function runningFetch(): Fetch {
  const fetch = mockPack.fetches[mockPack.fetches.length - 1];
  if (!fetch) throw new Error('No download is running');
  return fetch;
}

// Writes the pack's files into the fetch's directory up to `bytes`, the way a partial download would.
function write(fetch: Fetch, bytes: number): void {
  let left = bytes;
  for (const file of mockPack.files) {
    const size = Math.max(0, Math.min(file.size, left));
    left -= size;
    if (size > 0) mockDisk.files.set(`${fetch.dir}/${file.name}`, size);
  }
}

async function progress(fetch: Fetch, bytesWritten: number): Promise<void> {
  write(fetch, bytesWritten);
  for (const listener of [...mockPack.progressListeners]) listener({ bytesWritten, totalBytes: mockPackTotal() });
  await settle(2);
}

async function finish(fetch: Fetch): Promise<void> {
  write(fetch, mockPackTotal());
  fetch.done.resolve();
  await settle();
}

async function wifiReturns(): Promise<void> {
  mockPhone.network = 'WIFI';
  for (const listener of [...mockNetworkListeners]) listener({ type: 'WIFI', isConnected: true, isInternetReachable: true });
  await settle();
}

// Runs a whole download that succeeds, with progress along the way.
async function downloadModel(block: AiBlock, onUpdate?: (update: Update) => void): Promise<DownloadResult> {
  const result = block.download(onUpdate);
  await until(() => mockPack.fetches.length > 0, 'the pack fetch to start');
  const fetch = runningFetch();
  const total = mockPackTotal();
  await progress(fetch, 0);
  await progress(fetch, Math.floor(total / 3));
  await progress(fetch, Math.floor(total * 0.505));
  await progress(fetch, Math.floor(total * 0.996));
  await finish(fetch);
  return result;
}

function diskFiles(): string[] {
  return [...mockDisk.files.keys()].sort();
}

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_USE_FAKES;
  jest.clearAllMocks();
  mockDisk.files.clear();
  mockDisk.dirs.clear();
  mockPack.files = [
    { name: 'model-00001-of-00002.gguf', size: 1_200_000_000 },
    { name: 'model-00002-of-00002.gguf', size: 800_000_000 },
  ];
  mockPack.fetches.length = 0;
  mockPack.progressListeners.clear();
  mockPack.prompt = deferred<boolean>();
  mockNetworkListeners.clear();
  phone({});
});

describe('F007 AI model download', () => {
  it('download() resolves "not-needed" when status is "builtin" or "downloaded", and "not-supported" when status is "unavailable".', async () => {
    phone({ builtin: 'on' });
    let block = load();
    expect(await block.status()).toBe('builtin');
    expect(await block.download()).toBe('not-needed');

    phone({ builtin: 'off', totalMemory: 4 * GiB });
    block = load();
    expect(await block.status()).toBe('unavailable');
    expect(await block.download()).toBe('not-supported');

    phone({ builtin: 'missing', totalMemory: null });
    block = load();
    expect(await block.status()).toBe('unavailable');
    expect(await block.download()).toBe('not-supported');

    expect(mockPackModule.fetchAsync).not.toHaveBeenCalled();

    // Put the model on the phone, then ask again from a fresh start.
    phone({ builtin: 'off' });
    expect(await downloadModel(load())).toBe('downloaded');
    jest.clearAllMocks();
    block = load();
    expect(await block.status()).toBe('downloaded');
    expect(await block.download()).toBe('not-needed');
    expect(mockPackModule.fetchAsync).not.toHaveBeenCalled();
  });

  it('download() reports progress in whole percent from 0 to 100 and ends with status "downloaded".', async () => {
    const block = load();
    expect(await block.status()).toBe('downloadable');

    const updates: Update[] = [];
    const result = await downloadModel(block, (update) => updates.push(update));

    const percents = updates.filter((u): u is number => typeof u === 'number');
    expect(updates.filter((u) => typeof u !== 'number')).toEqual([]);
    expect(percents.length).toBeGreaterThanOrEqual(3);
    for (const p of percents) {
      expect({ p, whole: Number.isInteger(p), inRange: p >= 0 && p <= 100 }).toEqual({ p, whole: true, inRange: true });
    }
    for (let i = 1; i < percents.length; i++) expect(percents[i]!).toBeGreaterThanOrEqual(percents[i - 1]!);
    expect(percents[0]).toBe(0);
    expect(percents[percents.length - 1]).toBe(100);
    // Something between the ends was reported too.
    expect(percents.some((p) => p > 0 && p < 100)).toBe(true);

    expect(result).toBe('downloaded');
    expect(await block.status()).toBe('downloaded');
    expect(await load().status()).toBe('downloaded');
  });

  it('A download larger than 200 MB on mobile data reports "waiting-for-wifi" until Wi-Fi returns or the person accepts the phone\'s mobile-data prompt.', async () => {
    // Large pack, mobile data, the person ignores the prompt: waits, then Wi-Fi returns.
    phone({ network: 'CELLULAR' });
    let updates: Update[] = [];
    let block = load();
    let result = block.download((u) => updates.push(u));
    await until(() => updates.includes('waiting-for-wifi'), '"waiting-for-wifi"');
    await settle();
    expect(mockPackModule.showCellularDataConfirmationAsync).toHaveBeenCalled();
    expect(mockPackModule.fetchAsync).not.toHaveBeenCalled();
    expect(updates.filter((u) => typeof u === 'number' && u > 0)).toEqual([]);

    await wifiReturns();
    await until(() => mockPack.fetches.length === 1, 'the pack fetch to start after Wi-Fi returns');
    await finish(runningFetch());
    expect(await result).toBe('downloaded');
    expect(await block.status()).toBe('downloaded');

    // Large pack, mobile data, the person accepts the prompt: downloads on mobile data.
    mockDisk.files.clear();
    mockPack.fetches.length = 0;
    mockPack.prompt = deferred<boolean>();
    jest.clearAllMocks();
    phone({ network: 'CELLULAR' });
    updates = [];
    block = load();
    result = block.download((u) => updates.push(u));
    await until(() => updates.includes('waiting-for-wifi'), '"waiting-for-wifi"');
    await until(() => mockPackModule.showCellularDataConfirmationAsync.mock.calls.length > 0, 'the mobile-data prompt');
    expect(mockPackModule.fetchAsync).not.toHaveBeenCalled();
    mockPack.prompt.resolve(true);
    await until(() => mockPack.fetches.length === 1, 'the pack fetch to start after the prompt is accepted');
    expect(mockPhone.network).toBe('CELLULAR');
    await finish(runningFetch());
    expect(await result).toBe('downloaded');

    // Large pack, mobile data, the person declines the prompt: keeps waiting until Wi-Fi returns.
    mockDisk.files.clear();
    mockPack.fetches.length = 0;
    mockPack.prompt = deferred<boolean>();
    jest.clearAllMocks();
    phone({ network: 'CELLULAR' });
    updates = [];
    block = load();
    result = block.download((u) => updates.push(u));
    await until(() => mockPackModule.showCellularDataConfirmationAsync.mock.calls.length > 0, 'the mobile-data prompt');
    mockPack.prompt.resolve(false);
    await settle();
    expect(updates).toContain('waiting-for-wifi');
    expect(mockPackModule.fetchAsync).not.toHaveBeenCalled();
    await wifiReturns();
    await until(() => mockPack.fetches.length === 1, 'the pack fetch to start after Wi-Fi returns');
    await finish(runningFetch());
    expect(await result).toBe('downloaded');

    // Small pack on mobile data, and large pack on Wi-Fi: no waiting and no prompt.
    const noWait: [string, { name: string; size: number }[], NetworkType][] = [
      ['150 MB on mobile data', [{ name: 'model.gguf', size: 150_000_000 }], 'CELLULAR'],
      ['2 GB on Wi-Fi', mockPack.files, 'WIFI'],
    ];
    for (const [label, files, network] of noWait) {
      mockDisk.files.clear();
      mockPack.fetches.length = 0;
      mockPack.files = files;
      mockPack.prompt = deferred<boolean>();
      jest.clearAllMocks();
      phone({ network });
      updates = [];
      block = load();
      result = block.download((u) => updates.push(u));
      await until(() => mockPack.fetches.length === 1, `the pack fetch to start (${label})`);
      await finish(runningFetch());
      expect({ label, result: await result }).toEqual({ label, result: 'downloaded' });
      expect({ label, waited: updates.includes('waiting-for-wifi') }).toEqual({ label, waited: false });
      expect({ label, prompted: mockPackModule.showCellularDataConfirmationAsync.mock.calls.length }).toEqual({ label, prompted: 0 });
    }
  });

  it('A failed or cancelled download leaves status "downloadable" and no partial files.', async () => {
    // Failed part way through.
    let block = load();
    let result = block.download();
    await until(() => mockPack.fetches.length === 1, 'the pack fetch to start');
    let fetch = runningFetch();
    await progress(fetch, 1_500_000_000);
    expect(diskFiles().length).toBeGreaterThan(0);
    fetch.done.reject(new Error('The network connection was lost.'));

    expect(await result).toEqual({ error: expect.any(String) });
    expect(diskFiles()).toEqual([]);
    expect(await block.status()).toBe('downloadable');
    expect(await load().status()).toBe('downloadable');

    // Cancelled part way through.
    mockPack.fetches.length = 0;
    block = load();
    result = block.download();
    await until(() => mockPack.fetches.length === 1, 'the pack fetch to start');
    fetch = runningFetch();
    await progress(fetch, 400_000_000);
    expect(diskFiles().length).toBeGreaterThan(0);
    await block.cancelDownload();

    expect(await result).toEqual({ error: 'cancelled' });
    expect(mockPackModule.cancelAsync).toHaveBeenCalled();
    expect(diskFiles()).toEqual([]);
    expect(await block.status()).toBe('downloadable');
    expect(await load().status()).toBe('downloadable');

    // Cancelled while waiting for Wi-Fi: nothing is fetched and nothing is left.
    mockPack.fetches.length = 0;
    jest.clearAllMocks();
    phone({ network: 'CELLULAR' });
    const updates: Update[] = [];
    block = load();
    result = block.download((u) => updates.push(u));
    await until(() => updates.includes('waiting-for-wifi'), '"waiting-for-wifi"');
    await block.cancelDownload();

    expect(await result).toEqual({ error: 'cancelled' });
    await wifiReturns();
    expect(mockPackModule.fetchAsync).not.toHaveBeenCalled();
    expect(diskFiles()).toEqual([]);
    expect(await block.status()).toBe('downloadable');
  });

  it('remove() deletes the model files, sets status to "downloadable", and returns the bytes freed.', async () => {
    expect(await downloadModel(load())).toBe('downloaded');
    expect(diskFiles().length).toBe(2);

    // A fresh start, so the block finds the files on the phone rather than remembering them.
    const block = load();
    expect(await block.status()).toBe('downloaded');
    const freed = await block.remove();

    expect(freed).toBe(2_000_000_000);
    expect(diskFiles()).toEqual([]);
    expect(await block.status()).toBe('downloadable');
    expect(await load().status()).toBe('downloadable');
  });
});
