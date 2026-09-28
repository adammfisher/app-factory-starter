// In-memory text block. recognize() reads whatever lines the test set, in reading order, and
// translate() prefixes the text with the language code once that language is "downloaded".
import { isBlank, readingOrder, type DownloadResult, type Failure, type Image, type Language, type RecognizedLine } from './text';

let fakeLines: RecognizedLine[] = [];
let fakeLanguages: Language[] = [
  { code: 'en', downloaded: true },
  { code: 'es', downloaded: false },
];
let acceptDownload = true;

export function setFakeLines(lines: RecognizedLine[]): void {
  fakeLines = lines.map((l) => ({ ...l, frame: { ...l.frame } }));
}

export function setFakeLanguages(languages: Language[]): void {
  fakeLanguages = languages.map((l) => ({ ...l }));
}

export function setFakeAcceptDownload(accept: boolean): void {
  acceptDownload = accept;
}

export async function recognize(image: Image): Promise<string[] | Failure> {
  if (!image?.path) return [];
  return readingOrder(fakeLines);
}

export async function languages(): Promise<Language[] | Failure> {
  return fakeLanguages.map((l) => ({ ...l }));
}

export async function translate(text: string, code: string): Promise<string | Failure> {
  if (isBlank(text)) return text;
  const language = fakeLanguages.find((l) => l.code === code);
  if (!language) return { error: 'not-supported' };
  if (!language.downloaded) return { error: 'needs-download' };
  return `[${code}] ${text}`;
}

export async function downloadLanguage(code: string): Promise<DownloadResult> {
  if (!acceptDownload) return 'declined';
  const language = fakeLanguages.find((l) => l.code === code);
  if (!language) return { error: 'not-supported' };
  language.downloaded = true;
  return 'downloaded';
}
