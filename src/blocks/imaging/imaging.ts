// The imaging block's operations, independent of where files live. Every operation decodes its
// inputs, works on the pixels in JavaScript and writes a new file; inputs are never changed.
// Filters, crop, split and stack write PNG so their pixels stay exact; resize writes JPEG.
import * as pixels from './bitmap';
import type { Bitmap, Filter } from './bitmap';
import { decodeJpeg, encodeJpeg, isJpeg } from './jpeg';
import { decodePng, encodePng, isPng } from './png';

export type { Filter } from './bitmap';

// path is a file:// URI on iOS and Android and a data: URI on the web.
export type Image = { path: string; width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type ImagingError =
  | 'bad-rect' // the rect is not whole pixels inside the image
  | 'bad-size' // resize's maxSide is not a whole number of pixels, or its quality is outside 0…1
  | 'bad-filter'
  | 'too-small' // splitHalves on an image one pixel wide
  | 'not-found' // the input file cannot be read
  | 'bad-image' // the input is not a PNG or JPEG this block can decode
  | 'write-failed';
export type Failure = { error: ImagingError };

export type ImagingIo = {
  read: (path: string) => Promise<Uint8Array>;
  write: (bytes: Uint8Array, extension: 'png' | 'jpg') => Promise<string>;
  remove: (path: string) => Promise<void>;
};

const FILTERS: readonly Filter[] = ['original', 'color', 'grayscale', 'blackwhite'];

class ImagingFailure extends Error {
  constructor(readonly code: ImagingError) {
    super(code);
  }
}

export function createImaging(io: ImagingIo) {
  const load = async (image: Image): Promise<Bitmap> => {
    let bytes: Uint8Array;
    try {
      bytes = await io.read(image.path);
    } catch {
      throw new ImagingFailure('not-found');
    }
    try {
      if (isPng(bytes)) return decodePng(bytes);
      if (isJpeg(bytes)) return decodeJpeg(bytes);
    } catch {
      // falls through to bad-image
    }
    throw new ImagingFailure('bad-image');
  };

  const save = async (bitmap: Bitmap, format: 'png' | 'jpg', quality = 0.9): Promise<Image> => {
    const bytes = format === 'png' ? encodePng(bitmap) : encodeJpeg(pixels.flatten(bitmap), quality);
    try {
      return { path: await io.write(bytes, format), width: bitmap.width, height: bitmap.height };
    } catch {
      throw new ImagingFailure('write-failed');
    }
  };

  // Runs an operation, turning its ImagingFailure into { error }.
  const run = async <T>(work: () => Promise<T>): Promise<T | Failure> => {
    try {
      return await work();
    } catch (e) {
      if (e instanceof ImagingFailure) return { error: e.code };
      throw e;
    }
  };

  const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

  return {
    // "original" re-encodes the input unchanged; "color" stretches contrast; "grayscale" keeps
    // luminance only; "blackwhite" thresholds each pixel to pure black or white.
    applyFilter: (image: Image, filter: Filter): Promise<Image | Failure> =>
      run(async () => {
        if (!FILTERS.includes(filter)) throw new ImagingFailure('bad-filter');
        return save(pixels.applyFilter(await load(image), filter), 'png');
      }),

    // rect is in pixels from the top-left corner and must lie wholly inside the image.
    crop: (image: Image, rect: Rect): Promise<Image | Failure> =>
      run(async () => {
        const bitmap = await load(image);
        const { x, y, width, height } = rect ?? ({} as Rect);
        const inside =
          [x, y, width, height].every(whole) && x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= bitmap.width && y + height <= bitmap.height;
        if (!inside) throw new ImagingFailure('bad-rect');
        return save(pixels.crop(bitmap, x, y, width, height), 'png');
      }),

    // Left half then right half; with an odd width the right half has the extra column.
    splitHalves: (image: Image): Promise<[Image, Image] | Failure> =>
      run(async () => {
        const bitmap = await load(image);
        if (bitmap.width < 2) throw new ImagingFailure('too-small');
        const half = Math.floor(bitmap.width / 2);
        const left = await save(pixels.crop(bitmap, 0, 0, half, bitmap.height), 'png');
        try {
          const right = await save(pixels.crop(bitmap, half, 0, bitmap.width - half, bitmap.height), 'png');
          return [left, right] as [Image, Image];
        } catch (e) {
          await io.remove(left.path).catch(() => undefined);
          throw e;
        }
      }),

    // top above bottom, left-aligned, on white where the narrower one leaves a gap.
    stack: (top: Image, bottom: Image): Promise<Image | Failure> =>
      run(async () => {
        const [a, b] = [await load(top), await load(bottom)];
        return save(pixels.stack(a, b), 'png');
      }),

    // Scales down so the longest side is maxSide (never up) and writes a JPEG at quality 0…1.
    resize: (image: Image, maxSide: number, quality: number): Promise<Image | Failure> =>
      run(async () => {
        if (!whole(maxSide) || maxSide < 1 || typeof quality !== 'number' || !(quality >= 0 && quality <= 1)) {
          throw new ImagingFailure('bad-size');
        }
        const bitmap = await load(image);
        const longest = Math.max(bitmap.width, bitmap.height);
        const ratio = longest > maxSide ? maxSide / longest : 1;
        const width = Math.max(1, Math.round(bitmap.width * ratio));
        const height = Math.max(1, Math.round(bitmap.height * ratio));
        return save(pixels.scale(pixels.flatten(bitmap), width, height), 'jpg', quality);
      }),
  };
}

export type ImagingBlock = ReturnType<typeof createImaging>;

let counter = 0;
// A new file name for each result, unique within and across app runs.
export function newName(extension: string): string {
  counter = (counter + 1) % 1e6;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
}
