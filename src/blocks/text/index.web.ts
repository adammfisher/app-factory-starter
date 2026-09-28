// Browsers have neither the phone's recognizer nor its translator, so recognize, translate and
// downloadLanguage resolve "not-available" and languages() is empty, without asking anything.
import { useFakes } from '../../env';
import * as fake from './fake';
import { isBlank, type DownloadResult, type Failure, type Image, type Language } from './text';

export type { DownloadResult, Failure, Image, Language, TextError } from './text';
export { isFailure } from './text';

const NOT_AVAILABLE: Failure = { error: 'not-available' };

async function webRecognize(_image: Image): Promise<string[] | Failure> {
  return NOT_AVAILABLE;
}

async function webLanguages(): Promise<Language[] | Failure> {
  return [];
}

async function webTranslate(text: string, _code: string): Promise<string | Failure> {
  return isBlank(text) ? text : NOT_AVAILABLE;
}

async function webDownloadLanguage(_code: string): Promise<DownloadResult> {
  return NOT_AVAILABLE;
}

const fakes = useFakes();

export const recognize: (image: Image) => Promise<string[] | Failure> = fakes ? fake.recognize : webRecognize;
export const languages: () => Promise<Language[] | Failure> = fakes ? fake.languages : webLanguages;
export const translate: (text: string, code: string) => Promise<string | Failure> = fakes ? fake.translate : webTranslate;
export const downloadLanguage: (code: string) => Promise<DownloadResult> = fakes ? fake.downloadLanguage : webDownloadLanguage;
export const setFakeLines = fake.setFakeLines;
export const setFakeLanguages = fake.setFakeLanguages;
export const setFakeAcceptDownload = fake.setFakeAcceptDownload;
