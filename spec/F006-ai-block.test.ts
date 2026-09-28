// The contract these tests hold the AI block to:
// - src/blocks/ai/index.ts (and index.web.ts) export:
//   - status(): "builtin" | "downloaded" | "downloadable" | "unavailable" (or a Promise of one).
//   - generate(instructions, input): resolves the model's text as a string, or { error: "<code>" }.
//   - summarize(text): resolves the summary as a string, or { error: "<code>" }.
// - The phone's own model (Apple's Foundation Models or Google's Gemini Nano) is reached through
//   requireOptionalNativeModule("AiBuiltin") from expo-modules-core. The module has
//   isAvailableAsync(): Promise<boolean> and generateAsync(instructions, input): Promise<string>.
//   A missing module reads as no built-in model.
// - The downloaded model is a .gguf file. The block checks it is there with expo-file-system
//   (File.exists, or getInfoAsync from expo-file-system/legacy) and runs it through llama.rn:
//   initLlama(params) resolves a context whose completion(params) resolves { text }.
// - Memory comes from expo-device's totalMemory, in bytes.
// - The built-in model wins over a downloaded one.
// - A word is a run of characters between whitespace. Input of more than 2,000 words is "too-long".
// - summarize splits the text into parts of at most 2,000 words, in order, summarizes each part,
//   then sends one request that combines the part summaries, and returns what that request returns.
// - index.web.ts's status() is "unavailable" without asking anything.

type Status = 'builtin' | 'downloaded' | 'downloadable' | 'unavailable';
type Failure = { error: string };
type AiBlock = {
  status: () => Status | Promise<Status>;
  generate: (instructions: string, input: string) => Promise<string | Failure>;
  summarize: (text: string) => Promise<string | Failure>;
};
type Builtin = 'missing' | 'off' | 'on';

const GiB = 1024 ** 3;

// Named mock… so jest.mock factories may use them.
const mockPhone = {
  builtin: 'missing' as Builtin,
  modelPresent: false,
  totalMemory: (8 * GiB) as number | null,
  reply: (_request: string): string => 'model text',
};
const mockRequests: string[] = [];

const mockBuiltinModule = {
  isAvailableAsync: jest.fn(async () => mockPhone.builtin === 'on'),
  generateAsync: jest.fn(async (...args: unknown[]) => {
    const request = JSON.stringify(args);
    mockRequests.push(request);
    return mockPhone.reply(request);
  }),
};

const mockCompletion = jest.fn(async (...args: unknown[]) => {
  const request = JSON.stringify(args[0]);
  mockRequests.push(request);
  const text = mockPhone.reply(request);
  return { text, content: text };
});
const mockInitLlama = jest.fn(async () => ({
  completion: mockCompletion,
  stopCompletion: jest.fn(async () => undefined),
  release: jest.fn(async () => undefined),
}));

const mockDownloads = {
  downloadAsync: jest.fn(),
  createDownloadResumable: jest.fn(),
  downloadFileAsync: jest.fn(),
};

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
      if (moduleName === 'AiBuiltin') return mockPhone.builtin === 'missing' ? null : mockBuiltinModule;
      return original ? original(moduleName) : null;
    },
  };
});

jest.mock('llama.rn', () => ({ initLlama: mockInitLlama, releaseAllLlama: jest.fn(async () => undefined) }), {
  virtual: true,
});

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
  'expo-file-system',
  () => {
    const present = (uri: string) => mockPhone.modelPresent && /\.gguf$/i.test(uri);
    const join = (parts: unknown[]) =>
      parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/').replace(/([^:])\/{2,}/g, '$1/');
    class Directory {
      uri: string;
      constructor(...parts: unknown[]) {
        this.uri = join(parts);
      }
      get exists() {
        return true;
      }
      create() {}
      list() {
        return mockPhone.modelPresent ? [new File(this.uri, 'model.gguf')] : [];
      }
    }
    class File {
      uri: string;
      constructor(...parts: unknown[]) {
        this.uri = join(parts);
      }
      get exists() {
        return present(this.uri);
      }
      get size() {
        return present(this.uri) ? 1_500_000_000 : 0;
      }
      static downloadFileAsync = mockDownloads.downloadFileAsync;
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
    getInfoAsync: async (uri: string) =>
      mockPhone.modelPresent && /\.gguf$/i.test(uri)
        ? { exists: true, isDirectory: false, size: 1_500_000_000, uri }
        : { exists: false, isDirectory: false, uri },
    readDirectoryAsync: async () => (mockPhone.modelPresent ? ['model.gguf'] : []),
    downloadAsync: mockDownloads.downloadAsync,
    createDownloadResumable: mockDownloads.createDownloadResumable,
  }),
  { virtual: true },
);

function phone(options: { builtin?: Builtin; modelPresent?: boolean; totalMemory?: number | null }): void {
  mockPhone.builtin = options.builtin ?? 'missing';
  mockPhone.modelPresent = options.modelPresent ?? false;
  mockPhone.totalMemory = options.totalMemory === undefined ? 8 * GiB : options.totalMemory;
}

function load(entry: 'index' | 'index.web' = 'index'): AiBlock {
  jest.resetModules();
  return require(`../src/blocks/ai/${entry}`) as AiBlock;
}

// "w1 w2 … wN": every word is numbered, so each request shows exactly which words it carries.
function numberedText(count: number, from = 1): string {
  const words = Array.from({ length: count }, (_, i) => `w${from + i}`);
  return words.map((w, i) => ((i + 1) % 40 === 0 ? `${w}.\n` : w)).join(' ');
}

function wordsIn(request: string): number[] {
  return [...request.matchAll(/\bw(\d+)\b/g)].map((m) => Number(m[1]));
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

const REACHABLE: [string, { builtin?: Builtin; modelPresent?: boolean }][] = [
  ['builtin', { builtin: 'on' }],
  ['downloaded', { builtin: 'off', modelPresent: true }],
];

const originalNetwork = {
  fetch: (global as Record<string, unknown>).fetch,
  XMLHttpRequest: (global as Record<string, unknown>).XMLHttpRequest,
  WebSocket: (global as Record<string, unknown>).WebSocket,
};
const network = {
  fetch: jest.fn(async () => {
    throw new Error('network call');
  }),
  XMLHttpRequest: jest.fn(),
  WebSocket: jest.fn(),
};

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_USE_FAKES;
  jest.clearAllMocks();
  mockRequests.length = 0;
  mockPhone.reply = () => 'model text';
  phone({});
  Object.assign(global, network);
});

afterEach(() => {
  Object.assign(global, originalNetwork);
});

describe('F006 AI block', () => {
  it('status() returns "builtin" when the phone reports Apple\'s or Google\'s on-device model, "downloaded" when the model file is present, "downloadable" when neither is present and the phone has 6 GB of memory or more, and "unavailable" otherwise.', async () => {
    const cases: [string, Parameters<typeof phone>[0], Status][] = [
      ['built-in model', { builtin: 'on' }, 'builtin'],
      ['built-in model and a model file', { builtin: 'on', modelPresent: true }, 'builtin'],
      ['built-in model on a 4 GB phone', { builtin: 'on', totalMemory: 4 * GiB }, 'builtin'],
      ['model file, no bridge', { builtin: 'missing', modelPresent: true }, 'downloaded'],
      ['model file, built-in model off', { builtin: 'off', modelPresent: true }, 'downloaded'],
      ['model file on a 4 GB phone', { builtin: 'off', modelPresent: true, totalMemory: 4 * GiB }, 'downloaded'],
      ['nothing, 6 GB', { builtin: 'off', totalMemory: 6 * GiB }, 'downloadable'],
      ['nothing, 8 GB', { builtin: 'missing', totalMemory: 8 * GiB }, 'downloadable'],
      ['nothing, 16 GB', { builtin: 'off', totalMemory: 16 * GiB }, 'downloadable'],
      ['nothing, 4 GB', { builtin: 'off', totalMemory: 4 * GiB }, 'unavailable'],
      ['nothing, 3 GB, no bridge', { builtin: 'missing', totalMemory: 3 * GiB }, 'unavailable'],
      ['nothing, memory unknown', { builtin: 'missing', totalMemory: null }, 'unavailable'],
    ];
    for (const [label, setup, expected] of cases) {
      phone(setup);
      const status = await load().status();
      expect({ label, status }).toEqual({ label, status: expected });
    }
  });

  it('generate(instructions, input) returns the model\'s text, and resolves the error "no-model" when status is "downloadable" or "unavailable".', async () => {
    const instructions = 'Answer in one short sentence';
    const input = 'What colour is the sky on a clear day';

    for (const [label, setup] of REACHABLE) {
      phone(setup);
      mockRequests.length = 0;
      mockPhone.reply = () => `The sky is blue (${label}).`;
      const text = await load().generate(instructions, input);
      expect({ label, text }).toEqual({ label, text: `The sky is blue (${label}).` });
      expect({ label, requests: mockRequests.length }).toEqual({ label, requests: 1 });
      expect(mockRequests[0]).toContain(instructions);
      expect(mockRequests[0]).toContain(input);
    }

    const noModel: [Status, Parameters<typeof phone>[0]][] = [
      ['downloadable', { builtin: 'off', totalMemory: 8 * GiB }],
      ['unavailable', { builtin: 'missing', totalMemory: 4 * GiB }],
    ];
    for (const [status, setup] of noModel) {
      phone(setup);
      mockRequests.length = 0;
      const block = load();
      expect(await block.status()).toBe(status);
      expect({ status, result: await block.generate(instructions, input) }).toEqual({ status, result: { error: 'no-model' } });
      expect({ status, requests: mockRequests.length }).toEqual({ status, requests: 0 });
    }
  });

  it('generate with input longer than 2,000 words resolves the error "too-long" and sends nothing to the model.', async () => {
    for (const [label, setup] of REACHABLE) {
      phone(setup);
      jest.clearAllMocks();
      const block = load();

      for (const count of [2001, 2500, 5000]) {
        mockRequests.length = 0;
        const result = await block.generate('Summarize this', numberedText(count));
        expect({ label, count, result }).toEqual({ label, count, result: { error: 'too-long' } });
        expect({ label, count, requests: mockRequests.length }).toEqual({ label, count, requests: 0 });
      }
      expect(mockBuiltinModule.generateAsync).not.toHaveBeenCalled();
      expect(mockCompletion).not.toHaveBeenCalled();

      // Exactly 2,000 words is not too long.
      mockRequests.length = 0;
      expect(await block.generate('Summarize this', numberedText(2000))).toBe('model text');
      expect(mockRequests).toHaveLength(1);
    }
  });

  it('summarize of a 5,000-word text sends parts of 2,000, 2,000 and 1,000 words, then one request that combines the three part summaries, and returns that combined summary.', async () => {
    const PART_SUMMARIES = ['alpha-part-summary', 'bravo-part-summary', 'charlie-part-summary'];
    const COMBINED = 'The combined summary of all three parts.';
    mockPhone.reply = (request) => {
      const words = wordsIn(request);
      if (words.length > 0) return PART_SUMMARIES[Math.floor((Math.min(...words) - 1) / 2000)] ?? 'unexpected part';
      if (PART_SUMMARIES.every((s) => request.includes(s))) return COMBINED;
      return 'unexpected request';
    };

    for (const [label, setup] of REACHABLE) {
      phone(setup);
      mockRequests.length = 0;
      const result = await load().summarize(numberedText(5000));

      expect({ label, requests: mockRequests.length }).toEqual({ label, requests: 4 });
      const parts = mockRequests.slice(0, 3).map(wordsIn);
      expect({ label, parts }).toEqual({ label, parts: [range(1, 2000), range(2001, 4000), range(4001, 5000)] });

      const combine = mockRequests[3] ?? '';
      expect({ label, wordsInCombine: wordsIn(combine) }).toEqual({ label, wordsInCombine: [] });
      for (const summary of PART_SUMMARIES) expect({ label, combineHas: summary, found: combine.includes(summary) }).toEqual({ label, combineHas: summary, found: true });

      expect({ label, result }).toEqual({ label, result: COMBINED });
    }
  });

  it('The block makes no network calls while generating or summarizing.', async () => {
    mockPhone.reply = (request) => (wordsIn(request).length > 0 ? 'part summary' : 'combined summary');

    for (const [label, setup] of REACHABLE) {
      phone(setup);
      const block = load();
      jest.clearAllMocks();
      mockRequests.length = 0;

      expect(typeof (await block.generate('Answer briefly', 'Hello there'))).toBe('string');
      expect(typeof (await block.summarize(numberedText(5000)))).toBe('string');
      expect({ label, modelRequests: mockRequests.length > 0 }).toEqual({ label, modelRequests: true });

      expect({ label, fetch: network.fetch.mock.calls.length }).toEqual({ label, fetch: 0 });
      expect({ label, xhr: network.XMLHttpRequest.mock.calls.length }).toEqual({ label, xhr: 0 });
      expect({ label, webSocket: network.WebSocket.mock.calls.length }).toEqual({ label, webSocket: 0 });
      for (const [name, fn] of Object.entries(mockDownloads)) {
        expect({ label, name, calls: fn.mock.calls.length }).toEqual({ label, name, calls: 0 });
      }
    }
  });

  it('On web, status() returns "unavailable".', async () => {
    for (const setup of [
      { builtin: 'on' as Builtin, modelPresent: true, totalMemory: 16 * GiB },
      { builtin: 'missing' as Builtin, modelPresent: false, totalMemory: 16 * GiB },
      { builtin: 'missing' as Builtin, modelPresent: false, totalMemory: null },
    ]) {
      phone(setup);
      expect(await load('index.web').status()).toBe('unavailable');
    }
    expect(mockBuiltinModule.isAvailableAsync).not.toHaveBeenCalled();
  });
});
