// Browsers have no app file system, so on the web images are read with fetch (a data:, blob: or
// http: URI) and each result is a data: URI holding the encoded PNG or JPEG. The pixel work is
// the same JavaScript as on iOS and Android.
import { useFakes } from '../../env';
import * as fake from './fake';
import { createImaging, type ImagingIo } from './imaging';

export type { Failure, Filter, Image, ImagingError, Rect } from './imaging';

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

const io: ImagingIo = {
  read: async (path) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  },
  write: async (bytes, extension) => `data:image/${extension === 'png' ? 'png' : 'jpeg'};base64,${toBase64(bytes)}`,
  remove: async () => undefined,
};

const real = createImaging(io);
const fakes = useFakes();

export const applyFilter: typeof fake.applyFilter = fakes ? fake.applyFilter : real.applyFilter;
export const crop: typeof fake.crop = fakes ? fake.crop : real.crop;
export const splitHalves: typeof fake.splitHalves = fakes ? fake.splitHalves : real.splitHalves;
export const stack: typeof fake.stack = fakes ? fake.stack : real.stack;
export const resize: typeof fake.resize = fakes ? fake.resize : real.resize;
