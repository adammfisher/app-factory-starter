// What the AI block does whatever runs the model: the word limit, and summarizing a long text in
// parts. Each platform's index supplies the status and the call that reaches its model.

export type Status = 'builtin' | 'downloaded' | 'downloadable' | 'unavailable';
export type AiError = 'no-model' | 'too-long' | 'failed';
export type Failure = { error: AiError };
export type Result = string | Failure;

// The most words one request may carry. Longer input is "too-long"; summarize splits at it.
export const MAX_WORDS = 2000;

export const SUMMARIZE_PART_INSTRUCTIONS =
  'Summarize the following text in a few sentences. Keep the names, numbers and decisions it contains.';
export const COMBINE_INSTRUCTIONS =
  'The following are summaries of consecutive parts of one text. Combine them into one summary of the whole text, in a few sentences.';

// A word is a run of characters between whitespace.
export function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

// Splits text into parts of at most `size` words, in order. Each part is cut from the original
// text, so line breaks and punctuation inside it survive.
export function splitWords(text: string, size: number = MAX_WORDS): string[] {
  const words = [...text.matchAll(/\S+/g)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  const parts: string[] = [];
  for (let i = 0; i < words.length; i += size) {
    const part = words.slice(i, i + size);
    parts.push(text.slice(part[0]?.start, part[part.length - 1]?.end));
  }
  return parts;
}

export function isFailure(result: Result): result is Failure {
  return typeof result !== 'string';
}

type Run = (instructions: string, input: string) => Promise<string>;

// Wraps the call that reaches a model with the checks every platform shares. `run` is only called
// once the input is known to fit, and only when `ready` says a model is there.
export function createGenerate(ready: () => Promise<boolean>, run: Run): (instructions: string, input: string) => Promise<Result> {
  return async (instructions, input) => {
    if (countWords(input) > MAX_WORDS) return { error: 'too-long' };
    if (!(await ready())) return { error: 'no-model' };
    try {
      return (await run(instructions, input)).trim();
    } catch {
      return { error: 'failed' };
    }
  };
}

// Summarizes each part of at most MAX_WORDS words, then asks for one summary of those summaries.
// A text that fits in one part is summarized in a single request.
export function createSummarize(generate: (instructions: string, input: string) => Promise<Result>): (text: string) => Promise<Result> {
  return async (text) => {
    const parts = splitWords(text);
    if (parts.length <= 1) return generate(SUMMARIZE_PART_INSTRUCTIONS, text);
    const summaries: string[] = [];
    for (const part of parts) {
      const summary = await generate(SUMMARIZE_PART_INSTRUCTIONS, part);
      if (isFailure(summary)) return summary;
      summaries.push(summary);
    }
    return generate(COMBINE_INSTRUCTIONS, summaries.join('\n\n'));
  };
}
