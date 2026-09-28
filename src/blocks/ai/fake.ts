// In-memory AI block. status() resolves whatever the test set; the "model" answers with the
// first words of its input, so results are predictable. The word limit and summarize are real.
import { createGenerate, createSummarize, type Status } from './ai';

let fakeStatus: Status = 'builtin';

export function setFakeStatus(value: Status): void {
  fakeStatus = value;
}

export async function status(): Promise<Status> {
  return fakeStatus;
}

export const generate = createGenerate(
  async () => fakeStatus === 'builtin' || fakeStatus === 'downloaded',
  async (_instructions, input) => input.split(/\s+/).filter(Boolean).slice(0, 12).join(' '),
);

export const summarize = createSummarize(generate);
