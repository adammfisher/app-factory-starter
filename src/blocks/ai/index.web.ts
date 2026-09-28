// Browsers have neither the phone's built-in model nor a way to run the downloaded one, so status()
// is "unavailable" without asking anything, and generate and summarize resolve "no-model".
import { useFakes } from '../../env';
import { createGenerate, createSummarize, type Result, type Status } from './ai';
import * as fake from './fake';

export type { AiError, Failure, Result, Status } from './ai';
export { countWords, isFailure, MAX_WORDS } from './ai';

export const MODEL_DIRECTORY = 'ai-model';

async function webStatus(): Promise<Status> {
  return 'unavailable';
}

const webGenerate = createGenerate(
  async () => false,
  async () => '',
);

const fakes = useFakes();

export const status: () => Promise<Status> = fakes ? fake.status : webStatus;
export const generate: (instructions: string, input: string) => Promise<Result> = fakes ? fake.generate : webGenerate;
export const summarize: (text: string) => Promise<Result> = fakes ? fake.summarize : createSummarize(webGenerate);
export const setFakeStatus = fake.setFakeStatus;
