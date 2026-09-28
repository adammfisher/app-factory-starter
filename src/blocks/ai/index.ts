import { Directory, File, Paths } from 'expo-file-system';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { LlamaContext } from 'llama.rn';

import { useFakes } from '../../env';
import { createGenerate, createSummarize, type DownloadResult, type DownloadUpdate, type Result, type Status } from './ai';
import * as fake from './fake';

export type { AiError, DownloadError, DownloadResult, DownloadUpdate, Failure, Result, Status } from './ai';
export { countWords, isFailure, MAX_WORDS } from './ai';

// The phone's own model: Apple's Foundation Models or Google's Gemini Nano, behind one native
// module. It is missing from builds that do not include it, which reads as no built-in model.
type AiBuiltin = {
  isAvailableAsync(): Promise<boolean>;
  generateAsync(instructions: string, input: string): Promise<string>;
};

// The downloaded model lives here as one or more .gguf files.
export const MODEL_DIRECTORY = 'ai-model';

// "6 GB" phones report a little under 6 GiB once the system has taken its share, so the line sits
// below 6 GiB and above every 4 GB phone.
const MIN_MEMORY_FOR_DOWNLOAD = 5 * 1024 ** 3;

// Room for 2,000 words of input (about 2,700 tokens), the instructions and the answer.
const CONTEXT_TOKENS = 4096;
const MAX_ANSWER_TOKENS = 512;

// Native modules are loaded on first use rather than at import, so with the fakes switch on they
// are never resolved (and a test's virtual mock is not bypassed by a cached resolution).
function builtin(): AiBuiltin | null {
  return requireOptionalNativeModule<AiBuiltin>('AiBuiltin');
}

function totalMemory(): number | null {
  return (require('expo-device') as typeof import('expo-device')).totalMemory;
}

async function builtinAvailable(): Promise<boolean> {
  try {
    return (await builtin()?.isAvailableAsync()) === true;
  } catch {
    return false;
  }
}

// The model file to load: the first part of a split model, else the first .gguf file.
function modelFile(): File | null {
  try {
    const directory = new Directory(Paths.document, MODEL_DIRECTORY);
    if (!directory.exists) return null;
    const files = directory
      .list()
      .filter((entry): entry is File => entry instanceof File && /\.gguf$/i.test(entry.uri) && entry.exists)
      .sort((a, b) => a.uri.localeCompare(b.uri));
    return files.find((f) => /-0*1-of-\d+\.gguf$/i.test(f.uri)) ?? files[0] ?? null;
  } catch {
    return null;
  }
}

async function realStatus(): Promise<Status> {
  if (await builtinAvailable()) return 'builtin';
  if (modelFile()) return 'downloaded';
  const memory = totalMemory();
  return memory !== null && memory >= MIN_MEMORY_FOR_DOWNLOAD ? 'downloadable' : 'unavailable';
}

// One llama context per model file, kept for the life of the app: loading takes seconds.
let llama: { uri: string; context: Promise<LlamaContext> } | null = null;

function llamaContext(uri: string): Promise<LlamaContext> {
  if (llama?.uri !== uri) {
    const { initLlama } = require('llama.rn') as typeof import('llama.rn');
    const context = initLlama({ model: uri, n_ctx: CONTEXT_TOKENS });
    context.catch(() => {
      if (llama?.context === context) llama = null;
    });
    llama = { uri, context };
  }
  return llama.context;
}

async function run(instructions: string, input: string): Promise<string> {
  const module = builtin();
  if (module && (await builtinAvailable())) return module.generateAsync(instructions, input);
  const file = modelFile();
  if (!file) throw new Error('no-model');
  const context = await llamaContext(file.uri);
  const result = await context.completion({
    messages: [
      { role: 'system', content: instructions },
      { role: 'user', content: input },
    ],
    n_predict: MAX_ANSWER_TOKENS,
  });
  return result.text;
}

// The store-hosted model: Apple-hosted asset packs on iOS, Google Play AI packs on Android, behind
// one native module. It is missing from builds that do not include it.
type AiModelPack = {
  getSizeAsync(): Promise<number>;
  fetchAsync(directoryUri: string): Promise<void>;
  cancelAsync(): Promise<void>;
  showCellularDataConfirmationAsync(): Promise<boolean>;
  addListener(eventName: 'onProgress', listener: (event: { bytesWritten: number; totalBytes: number }) => void): { remove(): void };
};

// A pack larger than this waits for Wi-Fi on mobile data unless the person agrees to the prompt.
const MAX_CELLULAR_BYTES = 200_000_000;

function modelPack(): AiModelPack | null {
  return requireOptionalNativeModule<AiModelPack>('AiModelPack');
}

function network(): typeof import('expo-network') {
  return require('expo-network') as typeof import('expo-network');
}

function modelDirectory(): Directory {
  return new Directory(Paths.document, MODEL_DIRECTORY);
}

// Deletes the model's files, partial or whole, and resolves the bytes they took up.
async function deleteModelFiles(): Promise<number> {
  if (llama) {
    const { context } = llama;
    llama = null;
    await context.then((c) => c.release()).catch(() => undefined);
  }
  const directory = modelDirectory();
  if (!directory.exists) return 0;
  const bytes = directory.size ?? 0;
  directory.delete();
  return bytes;
}

// The download in progress, so cancelDownload can reach it and a second download() joins it.
type Running = { cancelled: boolean; fetching: boolean; wake: () => void; result: Promise<DownloadResult> };
let running: Running | null = null;

// Resolves once Wi-Fi is back or the person accepts the mobile-data prompt, or the download is
// cancelled. Declining the prompt keeps waiting for Wi-Fi.
async function waitForWifi(pack: AiModelPack, current: Running): Promise<void> {
  const { addNetworkStateListener, NetworkStateType } = network();
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      subscription.remove();
      resolve();
    };
    const subscription = addNetworkStateListener((state) => {
      if (state.type !== NetworkStateType.CELLULAR && state.isConnected !== false) finish();
    });
    current.wake = finish;
    pack
      .showCellularDataConfirmationAsync()
      .then((accepted) => {
        if (accepted) finish();
      })
      .catch(() => undefined);
  });
}

async function runDownload(pack: AiModelPack, current: Running, onUpdate?: (update: DownloadUpdate) => void): Promise<DownloadResult> {
  let last = -1;
  const report = (percent: number) => {
    if (percent === last) return;
    last = percent;
    onUpdate?.(percent);
  };
  let progress: { remove(): void } | null = null;
  try {
    const size = await pack.getSizeAsync();
    if (size > MAX_CELLULAR_BYTES && !current.cancelled) {
      const state = await network().getNetworkStateAsync();
      if (state.type === network().NetworkStateType.CELLULAR) {
        onUpdate?.('waiting-for-wifi');
        await waitForWifi(pack, current);
      }
    }
    if (current.cancelled) return { error: 'cancelled' };
    progress = pack.addListener('onProgress', ({ bytesWritten, totalBytes }) => {
      // 100 is kept for the end, once every file is in place.
      if (totalBytes > 0) report(Math.min(99, Math.max(0, Math.floor((bytesWritten * 100) / totalBytes))));
    });
    const directory = modelDirectory();
    if (!directory.exists) directory.create();
    report(0);
    current.fetching = true;
    await pack.fetchAsync(directory.uri);
    if (current.cancelled) throw new Error('cancelled');
    report(100);
    return 'downloaded';
  } catch {
    await deleteModelFiles().catch(() => undefined);
    return { error: current.cancelled ? 'cancelled' : 'failed' };
  } finally {
    progress?.remove();
  }
}

async function realDownload(onUpdate?: (update: DownloadUpdate) => void): Promise<DownloadResult> {
  if (running) return running.result;
  const current = await realStatus();
  if (current === 'builtin' || current === 'downloaded') return 'not-needed';
  if (current === 'unavailable') return 'not-supported';
  const pack = modelPack();
  if (!pack) return { error: 'not-available' };
  if (running) return (running as Running).result;
  const download: Running = { cancelled: false, fetching: false, wake: () => undefined, result: Promise.resolve('downloaded') };
  running = download;
  download.result = runDownload(pack, download, onUpdate).finally(() => {
    if (running === download) running = null;
  });
  return download.result;
}

async function realCancelDownload(): Promise<void> {
  const current = running;
  if (!current || current.cancelled) return;
  current.cancelled = true;
  current.wake();
  if (current.fetching) await modelPack()?.cancelAsync().catch(() => undefined);
  await current.result;
}

async function realRemove(): Promise<number> {
  await realCancelDownload();
  try {
    return await deleteModelFiles();
  } catch {
    return 0;
  }
}

const realGenerate = createGenerate(async () => {
  const current = await realStatus();
  return current === 'builtin' || current === 'downloaded';
}, run);

const fakes = useFakes();

export const status: () => Promise<Status> = fakes ? fake.status : realStatus;
export const generate: (instructions: string, input: string) => Promise<Result> = fakes ? fake.generate : realGenerate;
export const summarize: (text: string) => Promise<Result> = fakes ? fake.summarize : createSummarize(realGenerate);
export const download: (onUpdate?: (update: DownloadUpdate) => void) => Promise<DownloadResult> = fakes ? fake.download : realDownload;
export const cancelDownload: () => Promise<void> = fakes ? fake.cancelDownload : realCancelDownload;
export const remove: () => Promise<number> = fakes ? fake.remove : realRemove;
export const setFakeStatus = fake.setFakeStatus;
