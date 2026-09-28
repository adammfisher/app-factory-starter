// The contract these tests hold the text block to:
// - src/blocks/text/index.ts (and index.web.ts) export:
//   - recognize(image): resolves the lines of text as strings, top to bottom, or { error: "<code>" }.
//   - languages(): resolves [{ code, downloaded }], code a language code such as "es".
//   - translate(text, code): resolves the translated text as a string, or { error: "<code>" };
//     a language not yet downloaded is { error: "needs-download" }.
//   - downloadLanguage(code): resolves "downloaded" or "declined".
// - An image is { path, width, height }: path is a file:// URI, width and height in pixels.
// - The phone's recognizer (Apple's Vision or Google's ML Kit) is reached through
//   requireOptionalNativeModule("TextRecognizer") from expo-modules-core. The module has
//   recognizeAsync(uri): Promise<{ text, frame: { x, y, width, height } }[]>, frames in pixels from
//   the image's top-left corner, lines in no particular order.
// - The phone's translator (Apple's Translation or Google's ML Kit) is reached through
//   requireOptionalNativeModule("Translator"). The module has
//   languagesAsync(): Promise<{ code, downloaded }[]>,
//   translateAsync(text, code): Promise<string>, which rejects for a language not downloaded, and
//   downloadAsync(code): Promise<boolean>, which shows the phone's download prompt and resolves
//   whether the language was downloaded.
// - A missing native module reads as "not-available".
// - index.web.ts resolves { error: "not-available" } for recognize and translate without asking
//   anything.

type Image = { path: string; width: number; height: number };
type Failure = { error: string };
type Language = { code: string; downloaded: boolean };
type TextBlock = {
  recognize: (image: Image) => Promise<string[] | Failure>;
  languages: () => Promise<Language[] | Failure>;
  translate: (text: string, code: string) => Promise<string | Failure>;
  downloadLanguage: (code: string) => Promise<'downloaded' | 'declined' | Failure>;
};
type Line = { text: string; frame: { x: number; y: number; width: number; height: number } };

// Named mock… so jest.mock factories may use them.
const mockPhone = {
  lines: [] as Line[],
  languages: [] as Language[],
  acceptDownload: true,
  translation: (text: string, code: string): string => `[${code}] ${text}`,
};

const mockRecognizer = {
  recognizeAsync: jest.fn(async (_uri: string) => mockPhone.lines.map((l) => ({ ...l, frame: { ...l.frame } }))),
};

const mockTranslator = {
  languagesAsync: jest.fn(async () => mockPhone.languages.map((l) => ({ ...l }))),
  translateAsync: jest.fn(async (text: string, code: string) => {
    const language = mockPhone.languages.find((l) => l.code === code);
    if (!language?.downloaded) {
      const error = new Error(`Language ${code} is not downloaded`) as Error & { code: string };
      error.code = 'ERR_NEEDS_DOWNLOAD';
      throw error;
    }
    return mockPhone.translation(text, code);
  }),
  downloadAsync: jest.fn(async (code: string) => {
    if (!mockPhone.acceptDownload) return false;
    const language = mockPhone.languages.find((l) => l.code === code);
    if (language) language.downloaded = true;
    return true;
  }),
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
      if (moduleName === 'TextRecognizer') return mockRecognizer;
      if (moduleName === 'Translator') return mockTranslator;
      return original ? original(moduleName) : null;
    },
  };
});

function phone(options: { lines?: Line[]; languages?: Language[]; acceptDownload?: boolean }): void {
  mockPhone.lines = options.lines ?? [];
  mockPhone.languages = (options.languages ?? []).map((l) => ({ ...l }));
  mockPhone.acceptDownload = options.acceptDownload ?? true;
}

function load(entry: 'index' | 'index.web' = 'index'): TextBlock {
  jest.resetModules();
  return require(`../src/blocks/text/${entry}`) as TextBlock;
}

function isFailure(value: unknown): value is Failure {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as Failure).error === 'string';
}

function line(text: string, y: number, x = 12): Line {
  return { text, frame: { x, y, width: 300, height: 28 } };
}

const IMAGE: Image = { path: 'file:///document/pages/page-1.jpg', width: 1200, height: 1600 };
const BLANK: Image = { path: 'file:///document/pages/blank.jpg', width: 1200, height: 1600 };

const LANGUAGES: Language[] = [
  { code: 'en', downloaded: true },
  { code: 'es', downloaded: false },
  { code: 'fr', downloaded: true },
  { code: 'de', downloaded: false },
];

function nativeCalls(): number {
  return [
    mockRecognizer.recognizeAsync,
    mockTranslator.languagesAsync,
    mockTranslator.translateAsync,
    mockTranslator.downloadAsync,
  ].reduce((n, fn) => n + fn.mock.calls.length, 0);
}

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
  phone({});
  Object.assign(global, network);
});

afterEach(() => {
  Object.assign(global, originalNetwork);
});

describe('F008 text block', () => {
  it('recognize(image) returns the text lines in reading order, top to bottom, and an image with no text returns an empty list.', async () => {
    phone({
      lines: [
        line('Total due: $118.40', 1320),
        line('INVOICE 4417', 80),
        line('2 x Widget  $59.20', 900, 40),
        line('Acme Supplies Ltd', 210),
        line('Date: 2026-09-28', 480, 600),
      ],
    });
    const block = load();

    const lines = await block.recognize(IMAGE);
    expect(lines).toEqual(['INVOICE 4417', 'Acme Supplies Ltd', 'Date: 2026-09-28', '2 x Widget  $59.20', 'Total due: $118.40']);
    expect(mockRecognizer.recognizeAsync).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockRecognizer.recognizeAsync.mock.calls[0])).toContain(IMAGE.path);

    phone({ lines: [] });
    expect(await block.recognize(BLANK)).toEqual([]);
    expect(JSON.stringify(mockRecognizer.recognizeAsync.mock.calls[1])).toContain(BLANK.path);
  });

  it("languages() returns the languages the phone's translator supports, each with its code and whether it is downloaded.", async () => {
    phone({ languages: LANGUAGES });
    const result = await load().languages();

    if (isFailure(result)) throw new Error(`expected languages, got the error "${result.error}"`);
    const byCode = [...result].sort((a, b) => a.code.localeCompare(b.code)).map((l) => ({ code: l.code, downloaded: l.downloaded }));
    expect(byCode).toEqual([
      { code: 'de', downloaded: false },
      { code: 'en', downloaded: true },
      { code: 'es', downloaded: false },
      { code: 'fr', downloaded: true },
    ]);

    phone({ languages: [{ code: 'ja', downloaded: true }] });
    const other = await load().languages();
    if (isFailure(other)) throw new Error(`expected languages, got the error "${other.error}"`);
    expect(other.map((l) => ({ code: l.code, downloaded: l.downloaded }))).toEqual([{ code: 'ja', downloaded: true }]);
  });

  it('translate(text, "es") returns the translated text, and a language not yet downloaded resolves "needs-download".', async () => {
    mockPhone.translation = (text, code) => (code === 'es' && text === 'Good morning' ? 'Buenos días' : `[${code}] ${text}`);

    phone({ languages: LANGUAGES.map((l) => (l.code === 'es' ? { ...l, downloaded: true } : l)) });
    expect(await load().translate('Good morning', 'es')).toBe('Buenos días');
    expect(JSON.stringify(mockTranslator.translateAsync.mock.calls)).toContain('Good morning');

    phone({ languages: LANGUAGES });
    const block = load();
    expect(await block.translate('Good morning', 'es')).toEqual({ error: 'needs-download' });
    expect(await block.translate('Good morning', 'de')).toEqual({ error: 'needs-download' });
    expect(await block.translate('Good morning', 'fr')).toBe('[fr] Good morning');
  });

  it('downloadLanguage("es") shows the phone\'s download prompt and resolves "downloaded" or "declined".', async () => {
    phone({ languages: LANGUAGES, acceptDownload: false });
    let block = load();
    expect(await block.downloadLanguage('es')).toBe('declined');
    expect(mockTranslator.downloadAsync).toHaveBeenCalledTimes(1);
    expect(mockTranslator.downloadAsync.mock.calls[0]?.[0]).toBe('es');
    expect(await block.translate('Good morning', 'es')).toEqual({ error: 'needs-download' });

    jest.clearAllMocks();
    phone({ languages: LANGUAGES, acceptDownload: true });
    block = load();
    expect(await block.downloadLanguage('es')).toBe('downloaded');
    expect(mockTranslator.downloadAsync).toHaveBeenCalledTimes(1);
    expect(mockTranslator.downloadAsync.mock.calls[0]?.[0]).toBe('es');

    const after = await block.languages();
    if (isFailure(after)) throw new Error(`expected languages, got the error "${after.error}"`);
    expect(after.find((l) => l.code === 'es')?.downloaded).toBe(true);
    expect(await block.translate('Good morning', 'es')).toBe('[es] Good morning');
  });

  it('Empty text returns an empty result without calling the recognizer or the translator.', async () => {
    phone({ languages: LANGUAGES.map((l) => ({ ...l, downloaded: true })), lines: [line('Should not be read', 10)] });
    const block = load();

    expect(await block.translate('', 'es')).toBe('');
    expect(await block.translate('', 'fr')).toBe('');
    expect(mockTranslator.translateAsync).not.toHaveBeenCalled();
    expect(mockRecognizer.recognizeAsync).not.toHaveBeenCalled();

    // A language not downloaded still gives an empty result for empty text.
    phone({ languages: LANGUAGES });
    expect(await load().translate('', 'es')).toBe('');
    expect(mockTranslator.translateAsync).not.toHaveBeenCalled();
    expect(mockRecognizer.recognizeAsync).not.toHaveBeenCalled();
  });

  it('The block makes no network calls of its own, and on web recognize and translate resolve the error "not-available".', async () => {
    phone({ languages: LANGUAGES, lines: [line('Hello', 40), line('World', 90)] });
    const block = load();

    expect(await block.recognize(IMAGE)).toEqual(['Hello', 'World']);
    const languages = await block.languages();
    expect(isFailure(languages)).toBe(false);
    expect(await block.translate('Hello', 'fr')).toBe('[fr] Hello');
    expect(await block.translate('Hello', 'es')).toEqual({ error: 'needs-download' });
    expect(await block.downloadLanguage('es')).toBe('downloaded');
    expect(await block.translate('Hello', 'es')).toBe('[es] Hello');
    expect(nativeCalls()).toBeGreaterThan(0);

    expect(network.fetch).not.toHaveBeenCalled();
    expect(network.XMLHttpRequest).not.toHaveBeenCalled();
    expect(network.WebSocket).not.toHaveBeenCalled();

    jest.clearAllMocks();
    phone({ languages: LANGUAGES.map((l) => ({ ...l, downloaded: true })), lines: [line('Hello', 40)] });
    const web = load('index.web');
    expect(await web.recognize(IMAGE)).toEqual({ error: 'not-available' });
    expect(await web.translate('Hello', 'es')).toEqual({ error: 'not-available' });
    expect(await web.translate('Hello', 'fr')).toEqual({ error: 'not-available' });
    expect(nativeCalls()).toBe(0);
    expect(network.fetch).not.toHaveBeenCalled();
    expect(network.XMLHttpRequest).not.toHaveBeenCalled();
    expect(network.WebSocket).not.toHaveBeenCalled();
  });
});
