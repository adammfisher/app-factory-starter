// In-memory AI block. status() resolves whatever the test set; the "model" answers with the
// first words of its input, so results are predictable. The word limit and summarize are real.
import { createGenerate, createSummarize, type DownloadResult, type DownloadUpdate, type Status } from './ai';

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

// The fake model's size, returned by remove() once it is "downloaded".
const FAKE_MODEL_BYTES = 2_000_000_000;

let cancelled = false;

// Reports 0, 50 and 100 at once and marks the model downloaded, unless cancelled in between.
export async function download(onUpdate?: (update: DownloadUpdate) => void): Promise<DownloadResult> {
  if (fakeStatus === 'builtin' || fakeStatus === 'downloaded') return 'not-needed';
  if (fakeStatus === 'unavailable') return 'not-supported';
  cancelled = false;
  for (const percent of [0, 50, 100]) {
    await Promise.resolve();
    if (cancelled) return { error: 'cancelled' };
    onUpdate?.(percent);
  }
  fakeStatus = 'downloaded';
  return 'downloaded';
}

export async function cancelDownload(): Promise<void> {
  cancelled = true;
}

export async function remove(): Promise<number> {
  if (fakeStatus !== 'downloaded') return 0;
  fakeStatus = 'downloadable';
  return FAKE_MODEL_BYTES;
}
