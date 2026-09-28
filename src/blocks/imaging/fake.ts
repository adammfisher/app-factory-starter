// In-memory imaging block. It reads and writes no pixels: each result is a fake:// path with the
// size the real operation would give, and the same errors for the same inputs.
import type { Failure, Filter, Image, Rect } from './imaging';

let counter = 0;
function result(width: number, height: number, extension: 'png' | 'jpg'): Image {
  return { path: `fake://imaging/${++counter}.${extension}`, width, height };
}

const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

export async function applyFilter(image: Image, filter: Filter): Promise<Image | Failure> {
  if (!['original', 'color', 'grayscale', 'blackwhite'].includes(filter)) return { error: 'bad-filter' };
  return result(image.width, image.height, 'png');
}

export async function crop(image: Image, rect: Rect): Promise<Image | Failure> {
  const { x, y, width, height } = rect;
  const inside =
    [x, y, width, height].every(whole) && x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= image.width && y + height <= image.height;
  return inside ? result(width, height, 'png') : { error: 'bad-rect' };
}

export async function splitHalves(image: Image): Promise<[Image, Image] | Failure> {
  if (image.width < 2) return { error: 'too-small' };
  const half = Math.floor(image.width / 2);
  return [result(half, image.height, 'png'), result(image.width - half, image.height, 'png')];
}

export async function stack(top: Image, bottom: Image): Promise<Image | Failure> {
  return result(Math.max(top.width, bottom.width), top.height + bottom.height, 'png');
}

export async function resize(image: Image, maxSide: number, quality: number): Promise<Image | Failure> {
  if (!whole(maxSide) || maxSide < 1 || !(quality >= 0 && quality <= 1)) return { error: 'bad-size' };
  const longest = Math.max(image.width, image.height);
  const ratio = longest > maxSide ? maxSide / longest : 1;
  return result(Math.max(1, Math.round(image.width * ratio)), Math.max(1, Math.round(image.height * ratio)), 'jpg');
}
