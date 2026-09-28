// In-memory pdf block. It reads no images and writes no file: each PDF is a fake:// path whose
// pages, text and password are kept in memory, with the same errors for the same inputs.
import { checkWrite, type Failure, type Page, type WriteOptions, type Written } from './pdf';

const files = new Map<string, { texts: string[]; password?: string }>();
let counter = 0;

export async function write(pages: Page[], options?: WriteOptions): Promise<Written | Failure> {
  const problem = checkWrite(pages, options);
  if (problem) return { error: problem };
  const path = `fake://pdf/${++counter}.pdf`;
  files.set(path, { texts: pages.map((p) => p.text ?? ''), password: options?.password || undefined });
  return { path };
}

export async function readText(path: string, password?: string): Promise<string[] | Failure> {
  const file = files.get(path);
  if (!file) return { error: 'not-found' };
  if (file.password !== undefined && password !== file.password) return { error: password ? 'wrong-password' : 'password-required' };
  return [...file.texts];
}
