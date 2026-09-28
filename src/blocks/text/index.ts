import { requireOptionalNativeModule } from 'expo-modules-core';

import { useFakes } from '../../env';
import * as fake from './fake';
import { isBlank, readingOrder, type DownloadResult, type Failure, type Image, type Language, type RecognizedLine } from './text';

export type { DownloadResult, Failure, Image, Language, TextError } from './text';
export { isFailure } from './text';

// The phone's recognizer (Apple's Vision or Google's ML Kit) and translator (Apple's Translation
// or Google's ML Kit), each behind one native module. Both run on the phone: the block makes no
// network calls of its own. A module missing from the build reads as "not-available".
type TextRecognizer = {
  recognizeAsync(uri: string): Promise<RecognizedLine[]>;
};

type Translator = {
  languagesAsync(): Promise<Language[]>;
  // Rejects for a language not downloaded, with the code ERR_NEEDS_DOWNLOAD.
  translateAsync(text: string, code: string): Promise<string>;
  // Shows the phone's download prompt and resolves whether the language was downloaded.
  downloadAsync(code: string): Promise<boolean>;
};

const NOT_AVAILABLE: Failure = { error: 'not-available' };

// Native modules are loaded on first use rather than at import, so with the fakes switch on they
// are never resolved.
function recognizer(): TextRecognizer | null {
  return requireOptionalNativeModule<TextRecognizer>('TextRecognizer');
}

function translator(): Translator | null {
  return requireOptionalNativeModule<Translator>('Translator');
}

async function realRecognize(image: Image): Promise<string[] | Failure> {
  if (!image?.path) return [];
  const module = recognizer();
  if (!module) return NOT_AVAILABLE;
  try {
    return readingOrder(await module.recognizeAsync(image.path));
  } catch {
    return { error: 'failed' };
  }
}

async function realLanguages(): Promise<Language[] | Failure> {
  const module = translator();
  if (!module) return NOT_AVAILABLE;
  try {
    return (await module.languagesAsync()).map((l) => ({ code: l.code, downloaded: l.downloaded === true }));
  } catch {
    return { error: 'failed' };
  }
}

// Why a translation was refused: the error's code when the bridge gives one, otherwise the
// language list says whether the language is missing or not downloaded.
async function translateFailure(module: Translator, error: unknown, code: string): Promise<Failure> {
  if ((error as { code?: unknown } | null)?.code === 'ERR_NEEDS_DOWNLOAD') return { error: 'needs-download' };
  try {
    const language = (await module.languagesAsync()).find((l) => l.code === code);
    if (!language) return { error: 'not-supported' };
    if (!language.downloaded) return { error: 'needs-download' };
  } catch {
    // Fall through to "failed".
  }
  return { error: 'failed' };
}

async function realTranslate(text: string, code: string): Promise<string | Failure> {
  if (isBlank(text)) return text;
  const module = translator();
  if (!module) return NOT_AVAILABLE;
  try {
    return await module.translateAsync(text, code);
  } catch (error) {
    return translateFailure(module, error, code);
  }
}

async function realDownloadLanguage(code: string): Promise<DownloadResult> {
  const module = translator();
  if (!module) return NOT_AVAILABLE;
  try {
    return (await module.downloadAsync(code)) ? 'downloaded' : 'declined';
  } catch {
    return { error: 'failed' };
  }
}

const fakes = useFakes();

export const recognize: (image: Image) => Promise<string[] | Failure> = fakes ? fake.recognize : realRecognize;
export const languages: () => Promise<Language[] | Failure> = fakes ? fake.languages : realLanguages;
export const translate: (text: string, code: string) => Promise<string | Failure> = fakes ? fake.translate : realTranslate;
export const downloadLanguage: (code: string) => Promise<DownloadResult> = fakes ? fake.downloadLanguage : realDownloadLanguage;
export const setFakeLines = fake.setFakeLines;
export const setFakeLanguages = fake.setFakeLanguages;
export const setFakeAcceptDownload = fake.setFakeAcceptDownload;
