import { Directory, File, Paths } from 'expo-file-system';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { LlamaContext } from 'llama.rn';

import { useFakes } from '../../env';
import { createGenerate, createSummarize, type Result, type Status } from './ai';
import * as fake from './fake';

export type { AiError, Failure, Result, Status } from './ai';
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

const realGenerate = createGenerate(async () => {
  const current = await realStatus();
  return current === 'builtin' || current === 'downloaded';
}, run);

const fakes = useFakes();

export const status: () => Promise<Status> = fakes ? fake.status : realStatus;
export const generate: (instructions: string, input: string) => Promise<Result> = fakes ? fake.generate : realGenerate;
export const summarize: (text: string) => Promise<Result> = fakes ? fake.summarize : createSummarize(realGenerate);
export const setFakeStatus = fake.setFakeStatus;
