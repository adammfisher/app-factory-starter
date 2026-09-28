// The web build uses the same JavaScript writer and reader as the phones' fallback (SPEC.md
// decision for R-008: pdf-lib's role on the web). Where expo-file-system has a real file system
// (tests, and any host that provides one) file:// paths go through it. In a browser, which has
// none, images and PDFs are read with fetch (data:, blob: or http: URIs) and each new PDF is a
// data: URI.
import { Directory, File, Paths } from 'expo-file-system';

import { useFakes } from '../../env';
import * as fake from './fake';
import { createPdf, newName, type PdfIo } from './pdf';

export type { Failure, Image, Page, PageSize, PdfError, WriteOptions, Written } from './pdf';
export { MAX_PASSWORD, MIN_PASSWORD } from './pdf';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    parts.push(
      BASE64[(n >> 18) & 63]! +
        BASE64[(n >> 12) & 63]! +
        (i + 1 < bytes.length ? BASE64[(n >> 6) & 63]! : '=') +
        (i + 2 < bytes.length ? BASE64[n & 63]! : '='),
    );
  }
  return parts.join('');
}

// The documents folder when this host has a file system, else null.
function documents(): Directory | null {
  try {
    const dir = Paths.document;
    return typeof dir?.uri === 'string' && dir.uri.startsWith('file:') ? dir : null;
  } catch {
    return null;
  }
}

const io: PdfIo = {
  read: async (path) => {
    if (path.startsWith('file:')) return new File(path).bytes();
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  },
  write: async (bytes) => {
    const root = documents();
    if (!root) return `data:application/pdf;base64,${toBase64(bytes)}`;
    const folder = new Directory(root, 'pdf');
    folder.create({ intermediates: true, idempotent: true });
    const file = new File(folder, newName());
    file.create();
    try {
      file.write(bytes);
    } catch (e) {
      file.delete();
      throw e;
    }
    return file.uri;
  },
};

const real = createPdf(io);
const fakes = useFakes();

export const write: typeof fake.write = fakes ? fake.write : real.write;
export const readText: typeof fake.readText = fakes ? fake.readText : real.readText;
