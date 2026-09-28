// The pdf block's operations, independent of where files live. write builds the whole file in
// memory and writes it once, so a failure leaves nothing behind.
import { pdfImage, type PdfImage } from './images';
import { readPdfText, ReadFailure } from './reader';
import { buildPdf, type PageSize } from './writer';

export type { PageSize } from './writer';

// path is a file:// URI to a PNG or JPEG; width and height are its size in pixels.
export type Image = { path: string; width: number; height: number };
// text is the page's invisible text layer: searchable and copyable, never drawn.
export type Page = { image: Image; text?: string };
// pageSize defaults to "auto". An empty password means no password.
export type WriteOptions = { pageSize?: PageSize; password?: string };
export type Written = { path: string };
export type PdfError =
  | 'no-pages' // write was given an empty list of pages
  | 'bad-page' // a page has no image path, or text that is not a string
  | 'bad-page-size'
  | 'bad-password' // shorter than 4 or longer than 64 characters
  | 'not-found' // an input file cannot be read
  | 'bad-image' // a page image is not a PNG or JPEG
  | 'write-failed'
  | 'bad-pdf' // readText was given something that is not a PDF this block can read
  | 'password-required' // the PDF has a password and none was given
  | 'wrong-password'
  | 'unsupported-encryption'; // encrypted other than with AES-256 (revision 6)
export type Failure = { error: PdfError };

export type PdfIo = {
  read: (path: string) => Promise<Uint8Array>;
  write: (bytes: Uint8Array) => Promise<string>;
};

export const MIN_PASSWORD = 4;
export const MAX_PASSWORD = 64;
export const PAGE_SIZES: readonly PageSize[] = ['letter', 'a4', 'auto'];

// The first problem with write's arguments, or null. Shared with the fake.
export function checkWrite(pages: Page[], options?: WriteOptions): PdfError | null {
  if (!Array.isArray(pages) || pages.length === 0) return 'no-pages';
  for (const page of pages) {
    if (typeof page?.image?.path !== 'string' || (page.text !== undefined && typeof page.text !== 'string')) return 'bad-page';
  }
  if (options?.pageSize !== undefined && !PAGE_SIZES.includes(options.pageSize)) return 'bad-page-size';
  const password = options?.password;
  if (password !== undefined && password !== '') {
    const length = typeof password === 'string' ? Array.from(password).length : 0;
    if (length < MIN_PASSWORD || length > MAX_PASSWORD) return 'bad-password';
  }
  return null;
}

class PdfFailure extends Error {
  constructor(readonly code: PdfError) {
    super(code);
  }
}

export function createPdf(io: PdfIo) {
  return {
    // One page per entry, in order. Resolves the new file's path.
    write: async (pages: Page[], options?: WriteOptions): Promise<Written | Failure> => {
      const problem = checkWrite(pages, options);
      if (problem) return { error: problem };
      try {
        const inputs: { image: PdfImage; text?: string }[] = [];
        for (const page of pages) {
          let bytes: Uint8Array;
          try {
            bytes = await io.read(page.image.path);
          } catch {
            throw new PdfFailure('not-found');
          }
          try {
            inputs.push({ image: pdfImage(bytes), text: page.text });
          } catch {
            throw new PdfFailure('bad-image');
          }
        }
        const pdf = buildPdf(inputs, options?.pageSize ?? 'auto', options?.password || undefined);
        try {
          return { path: await io.write(pdf) };
        } catch {
          throw new PdfFailure('write-failed');
        }
      } catch (e) {
        if (e instanceof PdfFailure) return { error: e.code };
        throw e;
      }
    },

    // The text of each page, in order ("" for a page with none).
    readText: async (path: string, password?: string): Promise<string[] | Failure> => {
      let bytes: Uint8Array;
      try {
        bytes = await io.read(path);
      } catch {
        return { error: 'not-found' };
      }
      try {
        return readPdfText(bytes, password);
      } catch (e) {
        return { error: e instanceof ReadFailure ? e.code : 'bad-pdf' };
      }
    },
  };
}

export type PdfBlock = ReturnType<typeof createPdf>;

let counter = 0;
// A new file name for each PDF, unique within and across app runs.
export function newName(): string {
  counter = (counter + 1) % 1e6;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}.pdf`;
}
