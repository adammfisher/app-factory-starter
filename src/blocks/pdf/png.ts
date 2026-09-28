// PNG decode (every colour type and bit depth, interlaced or not) to 8-bit RGBA, in plain
// JavaScript. The same decoder as the imaging block's: a block never imports from another.
import { inflate } from './zlib';

// RGBA, 4 bytes per pixel, rows top to bottom.
export type Bitmap = { width: number; height: number; data: Uint8Array };

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// Adam7 passes: x start, y start, x step, y step.
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

function unfilter(raw: Uint8Array, offset: number, stride: number, rows: number, bpp: number): Uint8Array {
  const out = new Uint8Array(stride * rows);
  for (let y = 0; y < rows; y++) {
    const at = offset + y * (stride + 1);
    if (at + stride >= raw.length) throw new Error('truncated PNG data');
    const filter = raw[at]!;
    const row = y * stride;
    const up = row - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[row + i - bpp]! : 0;
      const b = y > 0 ? out[up + i]! : 0;
      let v = raw[at + 1 + i]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const c = y > 0 && i >= bpp ? out[up + i - bpp]! : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error('bad PNG filter');
      out[row + i] = v & 0xff;
    }
  }
  return out;
}

export function decodePng(bytes: Uint8Array): Bitmap {
  if (!isPng(bytes)) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array = new Uint8Array(0);
  let trns: Uint8Array = new Uint8Array(0);
  const idat: Uint8Array[] = [];
  let idatLength = 0;
  while (offset + 8 <= bytes.length) {
    const len = u32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const body = bytes.subarray(offset + 8, offset + 8 + len);
    if (body.length < len) throw new Error('truncated PNG');
    if (type === 'IHDR') {
      width = u32(body, 0);
      height = u32(body, 4);
      depth = body[8]!;
      colorType = body[9]!;
      interlace = body[12]!;
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') {
      idat.push(body);
      idatLength += body.length;
    } else if (type === 'IEND') break;
    offset += 12 + len;
  }
  const channels = CHANNELS[colorType];
  if (!channels || width <= 0 || height <= 0 || ![1, 2, 4, 8, 16].includes(depth)) throw new Error('unsupported PNG');
  const compressed = new Uint8Array(idatLength);
  let at = 0;
  for (const part of idat) {
    compressed.set(part, at);
    at += part.length;
  }

  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const rowBytes = (w: number): number => Math.ceil((w * bitsPerPixel) / 8);
  const raw = inflate(compressed, (rowBytes(width) + 1) * height);
  const maxSample = (1 << depth) - 1;

  const sample = (row: Uint8Array, base: number, index: number): number => {
    if (depth === 8) return row[base + index]!;
    if (depth === 16) return row[base + index * 2]!; // high byte
    const bit = index * depth;
    return (row[base + (bit >> 3)]! >> (8 - depth - (bit & 7))) & maxSample;
  };
  const scale = (v: number): number => (depth >= 8 ? v : Math.round((v * 255) / maxSample));
  const rawSample = (row: Uint8Array, base: number, index: number): number =>
    depth === 16 ? (row[base + index * 2]! << 8) | row[base + index * 2 + 1]! : sample(row, base, index);
  const transparentGray = colorType === 0 && trns.length >= 2 ? (trns[0]! << 8) | trns[1]! : -1;
  const transparentRgb =
    colorType === 2 && trns.length >= 6 ? [(trns[0]! << 8) | trns[1]!, (trns[2]! << 8) | trns[3]!, (trns[4]! << 8) | trns[5]!] : null;

  const data = new Uint8Array(width * height * 4);
  const put = (rows: Uint8Array, stride: number, xs: number, ys: number, xStep: number, yStep: number, w: number, h: number): void => {
    for (let y = 0; y < h; y++) {
      const base = y * stride;
      for (let x = 0; x < w; x++) {
        const o = ((ys + y * yStep) * width + xs + x * xStep) * 4;
        const s = (k: number): number => sample(rows, base, x * channels + k);
        if (colorType === 0) {
          const g = scale(s(0));
          data[o] = data[o + 1] = data[o + 2] = g;
          data[o + 3] = rawSample(rows, base, x) === transparentGray ? 0 : 255;
        } else if (colorType === 2) {
          data[o] = s(0);
          data[o + 1] = s(1);
          data[o + 2] = s(2);
          const clear =
            transparentRgb !== null &&
            rawSample(rows, base, x * 3) === transparentRgb[0] &&
            rawSample(rows, base, x * 3 + 1) === transparentRgb[1] &&
            rawSample(rows, base, x * 3 + 2) === transparentRgb[2];
          data[o + 3] = clear ? 0 : 255;
        } else if (colorType === 3) {
          const i = s(0);
          if (i * 3 + 2 >= palette.length) throw new Error('bad PNG palette index');
          data[o] = palette[i * 3]!;
          data[o + 1] = palette[i * 3 + 1]!;
          data[o + 2] = palette[i * 3 + 2]!;
          data[o + 3] = i < trns.length ? trns[i]! : 255;
        } else if (colorType === 4) {
          data[o] = data[o + 1] = data[o + 2] = s(0);
          data[o + 3] = s(1);
        } else {
          data[o] = s(0);
          data[o + 1] = s(1);
          data[o + 2] = s(2);
          data[o + 3] = s(3);
        }
      }
    }
  };

  if (interlace === 0) {
    const stride = rowBytes(width);
    put(unfilter(raw, 0, stride, height, bpp), stride, 0, 0, 1, 1, width, height);
  } else {
    let passOffset = 0;
    for (const [xs, ys, xStep, yStep] of ADAM7) {
      const w = Math.ceil((width - xs) / xStep);
      const h = Math.ceil((height - ys) / yStep);
      if (w <= 0 || h <= 0) continue;
      const stride = rowBytes(w);
      put(unfilter(raw, passOffset, stride, h, bpp), stride, xs, ys, xStep, yStep, w, h);
      passOffset += (stride + 1) * h;
    }
  }
  return { width, height, data };
}
