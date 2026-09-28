// Browsers have neither the phone's built-in model nor a way to run the downloaded one, so status()
// is "unavailable" without asking anything, generate and summarize resolve "no-model", download()
// resolves "not-supported" and there is never a model to remove.
import { useFakes } from '../../env';
import { createGenerate, createSummarize, type DownloadResult, type DownloadUpdate, type Result, type Status } from './ai';
import * as fake from './fake';

export type { AiError, DownloadError, DownloadResult, DownloadUpdate, Failure, Result, Status } from './ai';
export { countWords, isFailure, MAX_WORDS } from './ai';

export const MODEL_DIRECTORY = 'ai-model';

async function webStatus(): Promise<Status> {
  return 'unavailable';
}

const webGenerate = createGenerate(
  async () => false,
  async () => '',
);

async function webDownload(): Promise<DownloadResult> {
  return 'not-supported';
}

async function webCancelDownload(): Promise<void> {}

async function webRemove(): Promise<number> {
  return 0;
}

const fakes = useFakes();

export const status: () => Promise<Status> = fakes ? fake.status : webStatus;
export const generate: (instructions: string, input: string) => Promise<Result> = fakes ? fake.generate : webGenerate;
export const summarize: (text: string) => Promise<Result> = fakes ? fake.summarize : createSummarize(webGenerate);
export const download: (onUpdate?: (update: DownloadUpdate) => void) => Promise<DownloadResult> = fakes ? fake.download : webDownload;
export const cancelDownload: () => Promise<void> = fakes ? fake.cancelDownload : webCancelDownload;
export const remove: () => Promise<number> = fakes ? fake.remove : webRemove;
export const setFakeStatus = fake.setFakeStatus;
