// Page images as PDF image objects. A JPEG goes in as it is (DCTDecode). An 8-bit, non-interlaced
// grey or RGB PNG keeps its compressed data, which PDF reads with the same PNG predictors. Every
// other PNG is decoded to pixels and written again, with its alpha as a soft mask.
import { deflate } from './zlib';
import { decodePng, isPng } from './png';

export type PdfImage = {
  width: number;
  height: number;
  colorSpace: 'DeviceGray' | 'DeviceRGB' | 'DeviceCMYK';
  bitsPerComponent: number;
  filter: 'DCTDecode' | 'FlateDecode';
  // Colors and Columns for the PNG predictor, when the data keeps PNG filtering.
  predictor?: { colors: number; columns: number };
  // Adobe CMYK JPEGs store inverted values.
  invert?: boolean;
  data: Uint8Array;
  // 8-bit alpha, Flate-compressed, when any pixel is not opaque.
  alpha?: Uint8Array;
};

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function jpegImage(bytes: Uint8Array): PdfImage {
  let at = 2;
  let adobe = false;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) throw new Error('bad JPEG marker');
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    if (marker === 0xee && String.fromCharCode(...bytes.subarray(at + 4, at + 9)) === 'Adobe') adobe = true;
    // Any start-of-frame marker except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const precision = bytes[at + 4]!;
      const height = (bytes[at + 5]! << 8) | bytes[at + 6]!;
      const width = (bytes[at + 7]! << 8) | bytes[at + 8]!;
      const components = bytes[at + 9]!;
      const colorSpace = components === 1 ? 'DeviceGray' : components === 3 ? 'DeviceRGB' : components === 4 ? 'DeviceCMYK' : null;
      if (!colorSpace || width <= 0 || height <= 0) throw new Error('unsupported JPEG');
      return { width, height, colorSpace, bitsPerComponent: precision, filter: 'DCTDecode', invert: components === 4 && adobe, data: bytes };
    }
    at += 2 + length;
  }
  throw new Error('JPEG has no frame header');
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
}

// The compressed data of a PNG PDF can read directly, or null.
function pngPassthrough(bytes: Uint8Array): PdfImage | null {
  let at = 8;
  const idat: Uint8Array[] = [];
  let header: Uint8Array | null = null;
  while (at + 8 <= bytes.length) {
    const len = u32(bytes, at);
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    const body = bytes.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') header = body;
    else if (type === 'tRNS') return null;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (!header || idat.length === 0) return null;
  const [width, height, depth, colorType, interlace] = [u32(header, 0), u32(header, 4), header[8], header[9], header[12]];
  if (depth !== 8 || interlace !== 0 || (colorType !== 0 && colorType !== 2) || width <= 0 || height <= 0) return null;
  const colors = colorType === 0 ? 1 : 3;
  const data = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of idat) {
    data.set(part, offset);
    offset += part.length;
  }
  return {
    width,
    height,
    colorSpace: colors === 1 ? 'DeviceGray' : 'DeviceRGB',
    bitsPerComponent: 8,
    filter: 'FlateDecode',
    predictor: { colors, columns: width },
    data,
  };
}

function pngImage(bytes: Uint8Array): PdfImage {
  const direct = pngPassthrough(bytes);
  if (direct) return direct;
  const { width, height, data } = decodePng(bytes);
  const rgb = new Uint8Array(width * height * 3);
  const alpha = new Uint8Array(width * height);
  let opaque = true;
  for (let i = 0, j = 0; i < alpha.length; i++, j += 4) {
    rgb[i * 3] = data[j]!;
    rgb[i * 3 + 1] = data[j + 1]!;
    rgb[i * 3 + 2] = data[j + 2]!;
    alpha[i] = data[j + 3]!;
    if (alpha[i] !== 255) opaque = false;
  }
  return {
    width,
    height,
    colorSpace: 'DeviceRGB',
    bitsPerComponent: 8,
    filter: 'FlateDecode',
    data: deflate(rgb),
    alpha: opaque ? undefined : deflate(alpha),
  };
}

export function pdfImage(bytes: Uint8Array): PdfImage {
  if (isJpeg(bytes)) return jpegImage(bytes);
  if (isPng(bytes)) return pngImage(bytes);
  throw new Error('not a PNG or JPEG');
}
