// The contract these tests hold the text block to:
// - src/blocks/text/index.ts exports downloadLanguage(code): resolves "downloaded" when the owner
//   accepts the phone's download prompt, "declined" when they refuse it, or { error: "<code>" }.
// - The phone's translator is reached through requireOptionalNativeModule("Translator") from
//   expo-modules-core. Besides languagesAsync() and translateAsync(text, code) (see F015), the module
//   has downloadAsync(code): Promise<boolean>, which shows the phone's download prompt for that
//   language and resolves true once it is downloaded, or false when the prompt is declined.
// - A language downloaded this way can be translated into straight away.

type Failure = { error: string };
type Language = { code: string; downloaded: boolean };
type TextBlock = {
  languages: () => Promise<Language[] | Failure>;
  translate: (text: string, code: string) => Promise<string | Failure>;
  downloadLanguage: (code: string) => Promise<'downloaded' | 'declined' | Failure>;
};

// Named mock… so jest.mock factories may use them.
const mockPhone = {
  languages: [] as Language[],
  // What the owner does when the download prompt appears.
  accept: true,
  prompts: [] as string[],
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
    return `[${code}] ${text}`;
  }),
  downloadAsync: jest.fn(async (code: string) => {
    mockPhone.prompts.push(code);
    if (!mockPhone.accept) return false;
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
      if (moduleName === 'Translator') return mockTranslator;
      if (moduleName === 'TextRecognizer') return { recognizeAsync: jest.fn(async () => []) };
      return original ? original(moduleName) : null;
    },
  };
});

function phone(options: { languages?: Language[]; accept?: boolean }): void {
  mockPhone.languages = (options.languages ?? []).map((l) => ({ ...l }));
  mockPhone.accept = options.accept ?? true;
  mockPhone.prompts = [];
}

function load(): TextBlock {
  jest.resetModules();
  return require('../src/blocks/text/index') as TextBlock;
}

const LANGUAGES: Language[] = [
  { code: 'en', downloaded: true },
  { code: 'es', downloaded: false },
  { code: 'fr', downloaded: true },
];

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_USE_FAKES;
  jest.clearAllMocks();
  phone({});
});

describe('F016 text block language download', () => {
  it('downloadLanguage("es") shows the phone\'s download prompt and resolves "downloaded" or "declined".', async () => {
    // The owner accepts: the prompt is shown for Spanish, and Spanish can then be translated into.
    phone({ languages: LANGUAGES, accept: true });
    const block = load();
    expect(typeof block.downloadLanguage).toBe('function');

    expect(await block.translate('Good morning', 'es')).toEqual({ error: 'needs-download' });
    expect(await block.downloadLanguage('es')).toBe('downloaded');
    expect(mockPhone.prompts).toEqual(['es']);
    expect(await block.translate('Good morning', 'es')).toBe('[es] Good morning');
    const after = await block.languages();
    expect(Array.isArray(after) && after.find((l) => l.code === 'es')?.downloaded).toBe(true);

    // The owner declines: the prompt is shown, nothing is downloaded, and Spanish still needs a download.
    phone({ languages: LANGUAGES, accept: false });
    const declined = load();
    expect(await declined.downloadLanguage('es')).toBe('declined');
    expect(mockPhone.prompts).toEqual(['es']);
    expect(await declined.translate('Good morning', 'es')).toEqual({ error: 'needs-download' });
    const still = await declined.languages();
    expect(Array.isArray(still) && still.find((l) => l.code === 'es')?.downloaded).toBe(false);
  });
});
