import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

// The contract these tests hold the imaging block to:
// - src/blocks/imaging/index.ts exports, each resolving new images and never changing an input file:
//   - applyFilter(image, filter): filter is "original" | "color" | "grayscale" | "blackwhite".
//   - crop(image, rect): rect is { x, y, width, height } in pixels from the top-left corner.
//   - splitHalves(image): resolves [left, right].
//   - stack(top, bottom): top above bottom, left-aligned.
//   - resize(image, maxSide, quality): quality 0…1; scales down so the longest side is maxSide,
//     never up, and writes a JPEG.
// - An image is { path, width, height }: path is a file:// URI, width and height in pixels.
// - Every result is written to a new file. applyFilter, crop, splitHalves and stack write PNG
//   (8-bit or less per channel, not interlaced), so filtered pixels are exact.
// - Inputs may be PNG or JPEG.
// - Errors resolve { error: "<code>" } and write nothing; a rect reaching outside the image is
//   "bad-rect".
// - The block reads and writes files through expo-file-system (the default export or
//   expo-file-system/legacy), and decodes and encodes pixels in JavaScript.

type Image = { path: string; width: number; height: number };
type Rect = { x: number; y: number; width: number; height: number };
type Failure = { error: string };
type Filter = 'original' | 'color' | 'grayscale' | 'blackwhite';
type ImagingBlock = {
  applyFilter: (image: Image, filter: Filter) => Promise<Image | Failure>;
  crop: (image: Image, rect: Rect) => Promise<Image | Failure>;
  splitHalves: (image: Image) => Promise<[Image, Image] | Failure>;
  stack: (top: Image, bottom: Image) => Promise<Image | Failure>;
  resize: (image: Image, maxSide: number, quality: number) => Promise<Image | Failure>;
};
type Bitmap = { width: number; height: number; data: Uint8Array }; // RGBA, 4 bytes per pixel
type Rgb = [number, number, number];

jest.setTimeout(60_000);

// Named mock… so jest.mock factories may use it.
const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f004-'));
const INPUTS = path.join(mockRoot, 'inputs');
fs.mkdirSync(INPUTS, { recursive: true });
afterAll(() => fs.rmSync(mockRoot, { recursive: true, force: true }));

// expo-file-system backed by the real file system under a temp folder.
function mockFileSystem(root: string, legacy: boolean): Record<string, unknown> {
  const nodeFs = require('fs') as typeof import('fs');
  const nodePath = require('path') as typeof import('path');
  const docDir = nodePath.join(root, 'document');
  const cacheDir = nodePath.join(root, 'cache');
  nodeFs.mkdirSync(docDir, { recursive: true });
  nodeFs.mkdirSync(cacheDir, { recursive: true });

  const toPath = (uri: string): string => decodeURI(uri.replace(/^file:\/\//, ''));
  const toUri = (p: string): string => `file://${p}`;
  const encode = (buf: Buffer, encoding?: string): string => buf.toString(encoding === 'base64' ? 'base64' : 'utf8');
  const decode = (s: string, encoding?: string): Buffer => Buffer.from(s, encoding === 'base64' ? 'base64' : 'utf8');

  if (legacy) {
    return {
      documentDirectory: toUri(docDir) + '/',
      cacheDirectory: toUri(cacheDir) + '/',
      EncodingType: { UTF8: 'utf8', Base64: 'base64' },
      readAsStringAsync: async (uri: string, o?: { encoding?: string }) => encode(nodeFs.readFileSync(toPath(uri)), o?.encoding),
      writeAsStringAsync: async (uri: string, s: string, o?: { encoding?: string }) => {
        nodeFs.mkdirSync(nodePath.dirname(toPath(uri)), { recursive: true });
        nodeFs.writeFileSync(toPath(uri), decode(s, o?.encoding));
      },
      getInfoAsync: async (uri: string) => {
        const p = toPath(uri);
        if (!nodeFs.existsSync(p)) return { exists: false, isDirectory: false, uri };
        const st = nodeFs.statSync(p);
        return { exists: true, isDirectory: st.isDirectory(), size: st.size, modificationTime: st.mtimeMs / 1000, uri };
      },
      deleteAsync: async (uri: string, o?: { idempotent?: boolean }) => {
        const p = toPath(uri);
        if (!nodeFs.existsSync(p) && !o?.idempotent) throw new Error(`No file at ${uri}`);
        nodeFs.rmSync(p, { recursive: true, force: true });
      },
      makeDirectoryAsync: async (uri: string, o?: { intermediates?: boolean }) => {
        nodeFs.mkdirSync(toPath(uri), { recursive: !!o?.intermediates });
      },
      readDirectoryAsync: async (uri: string) => nodeFs.readdirSync(toPath(uri)),
      copyAsync: async ({ from, to }: { from: string; to: string }) => nodeFs.copyFileSync(toPath(from), toPath(to)),
      moveAsync: async ({ from, to }: { from: string; to: string }) => nodeFs.renameSync(toPath(from), toPath(to)),
    };
  }

  type Part = string | { uri: string };
  const joinParts = (parts: Part[]): string => {
    const strings = parts.map((p) => (typeof p === 'string' ? p : p.uri));
    const [first, ...rest] = strings;
    const base = toPath(first ?? '');
    return toUri(nodePath.join(base, ...rest.map((s) => toPath(s))));
  };

  class Directory {
    uri: string;
    constructor(...parts: Part[]) {
      this.uri = joinParts(parts).replace(/\/?$/, '/');
    }
    get exists(): boolean {
      return nodeFs.existsSync(toPath(this.uri)) && nodeFs.statSync(toPath(this.uri)).isDirectory();
    }
    get name(): string {
      return nodePath.basename(toPath(this.uri));
    }
    create(o?: { intermediates?: boolean; idempotent?: boolean }): void {
      if (this.exists && o?.idempotent) return;
      nodeFs.mkdirSync(toPath(this.uri), { recursive: o?.intermediates ?? true });
    }
    delete(): void {
      nodeFs.rmSync(toPath(this.uri), { recursive: true, force: true });
    }
    list(): (File | Directory)[] {
      return nodeFs.readdirSync(toPath(this.uri), { withFileTypes: true }).map((e) =>
        e.isDirectory() ? new Directory(this.uri, e.name) : new File(this.uri, e.name),
      );
    }
    createFile(name: string): File {
      const f = new File(this.uri, name);
      f.create();
      return f;
    }
    createDirectory(name: string): Directory {
      const d = new Directory(this.uri, name);
      d.create();
      return d;
    }
  }

  class File {
    uri: string;
    constructor(...parts: Part[]) {
      this.uri = joinParts(parts);
    }
    private get p(): string {
      return toPath(this.uri);
    }
    get exists(): boolean {
      return nodeFs.existsSync(this.p) && nodeFs.statSync(this.p).isFile();
    }
    get size(): number {
      return this.exists ? nodeFs.statSync(this.p).size : 0;
    }
    get name(): string {
      return nodePath.basename(this.p);
    }
    get extension(): string {
      return nodePath.extname(this.p);
    }
    get parentDirectory(): Directory {
      return new Directory(toUri(nodePath.dirname(this.p)));
    }
    create(o?: { overwrite?: boolean; intermediates?: boolean }): void {
      if (this.exists && !o?.overwrite) throw new Error(`File exists: ${this.uri}`);
      nodeFs.mkdirSync(nodePath.dirname(this.p), { recursive: true });
      nodeFs.writeFileSync(this.p, Buffer.alloc(0));
    }
    write(content: string | Uint8Array, o?: { encoding?: string }): void {
      nodeFs.mkdirSync(nodePath.dirname(this.p), { recursive: true });
      nodeFs.writeFileSync(this.p, typeof content === 'string' ? decode(content, o?.encoding) : Buffer.from(content));
    }
    bytesSync(): Uint8Array {
      return new Uint8Array(nodeFs.readFileSync(this.p));
    }
    async bytes(): Promise<Uint8Array> {
      return this.bytesSync();
    }
    async arrayBuffer(): Promise<ArrayBuffer> {
      const b = this.bytesSync();
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    }
    textSync(): string {
      return nodeFs.readFileSync(this.p, 'utf8');
    }
    async text(): Promise<string> {
      return this.textSync();
    }
    base64Sync(): string {
      return nodeFs.readFileSync(this.p).toString('base64');
    }
    async base64(): Promise<string> {
      return this.base64Sync();
    }
    delete(): void {
      nodeFs.rmSync(this.p, { force: true });
    }
    copy(dest: File | Directory): void {
      const target = dest instanceof Directory ? nodePath.join(toPath(dest.uri), this.name) : toPath(dest.uri);
      nodeFs.copyFileSync(this.p, target);
    }
    move(dest: File | Directory): void {
      const target = dest instanceof Directory ? nodePath.join(toPath(dest.uri), this.name) : toPath(dest.uri);
      nodeFs.renameSync(this.p, target);
      this.uri = toUri(target);
    }
  }

  return {
    File,
    Directory,
    Paths: {
      cache: new Directory(toUri(cacheDir)),
      document: new Directory(toUri(docDir)),
      join: (...parts: Part[]) => joinParts(parts),
    },
  };
}

jest.mock('expo-file-system', () => mockFileSystem(mockRoot, false));
jest.mock('expo-file-system/legacy', () => mockFileSystem(mockRoot, true));

// --- A small PNG codec and JPEG header reader, so the tests depend on nothing the block might use.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function encodePng(bitmap: Bitmap): Buffer {
  const chunk = (type: string, body: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(bitmap.width, 0);
  ihdr.writeUInt32BE(bitmap.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = bitmap.width * 4;
  const raw = Buffer.alloc((stride + 1) * bitmap.height);
  for (let y = 0; y < bitmap.height; y++) {
    Buffer.from(bitmap.data.buffer, bitmap.data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function isPng(buf: Buffer): boolean {
  return buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

function isJpeg(buf: Buffer): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function decodePng(buf: Buffer): Bitmap {
  if (!isPng(buf)) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer = Buffer.alloc(0);
  let trns: Buffer = Buffer.alloc(0);
  const idat: Buffer[] = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const body = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      colorType = body[9]!;
      interlace = body[12]!;
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    offset += 12 + len;
  }
  if (interlace !== 0) throw new Error('interlaced PNG');
  if (depth > 8) throw new Error(`PNG bit depth ${depth}`);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels) throw new Error(`PNG colour type ${colorType}`);
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let v = src[i]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = v & 0xff;
    }
  }
  const sample = (row: Buffer, index: number): number => {
    if (depth === 8) return row[index]!;
    const bit = index * depth;
    const shift = 8 - depth - (bit % 8);
    return (row[bit >> 3]! >> shift) & ((1 << depth) - 1);
  };
  const scale = (v: number): number => (depth === 8 || colorType === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1)));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = (k: number) => sample(row, x * channels + k);
      if (colorType === 0) {
        const g = scale(s(0));
        data.set([g, g, g, 255], o);
      } else if (colorType === 2) data.set([s(0), s(1), s(2), 255], o);
      else if (colorType === 3) {
        const i = s(0);
        data.set([palette[i * 3]!, palette[i * 3 + 1]!, palette[i * 3 + 2]!, i < trns.length ? trns[i]! : 255], o);
      } else if (colorType === 4) data.set([s(0), s(0), s(0), s(1)], o);
      else data.set([s(0), s(1), s(2), s(3)], o);
    }
  }
  return { width, height, data };
}

function jpegSize(buf: Buffer): { width: number; height: number } {
  if (!isJpeg(buf)) throw new Error('not a JPEG');
  let offset = 2;
  while (offset < buf.length) {
    if (buf[offset] !== 0xff) throw new Error('bad JPEG marker');
    const marker = buf[offset + 1]!;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const len = buf.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    offset += 2 + len;
  }
  throw new Error('JPEG has no frame header');
}

// --- Test images and result helpers.

let counter = 0;
function writeImage(width: number, height: number, colour: (x: number, y: number) => Rgb): Image {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set([...colour(x, y), 255], (y * width + x) * 4);
  }
  const file = path.join(INPUTS, `input-${++counter}.png`);
  fs.writeFileSync(file, encodePng({ width, height, data }));
  return { path: `file://${file}`, width, height };
}

function fileOf(image: Image): string {
  return decodeURI(image.path.replace(/^file:\/\//, ''));
}

function bytesOf(image: Image): Buffer {
  return fs.readFileSync(fileOf(image));
}

function isFailure(value: unknown): value is Failure {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as Failure).error === 'string';
}

function expectImage(value: Image | Failure): Image {
  if (isFailure(value)) throw new Error(`expected an image, got the error "${value.error}"`);
  expect(typeof value.path).toBe('string');
  expect(fs.existsSync(fileOf(value))).toBe(true);
  return value;
}

// The image's pixels, read from its file; its reported size must match the file.
function pixelsOf(image: Image): Bitmap {
  const buf = bytesOf(image);
  expect({ png: isPng(buf) }).toEqual({ png: true });
  const bitmap = decodePng(buf);
  expect({ width: image.width, height: image.height }).toEqual({ width: bitmap.width, height: bitmap.height });
  return bitmap;
}

function sizeOf(image: Image): { width: number; height: number } {
  const buf = bytesOf(image);
  const size = isJpeg(buf) ? jpegSize(buf) : decodePng(buf);
  expect({ width: image.width, height: image.height }).toEqual({ width: size.width, height: size.height });
  return { width: size.width, height: size.height };
}

function pixel(bitmap: Bitmap, x: number, y: number): Rgb {
  const o = (y * bitmap.width + x) * 4;
  return [bitmap.data[o]!, bitmap.data[o + 1]!, bitmap.data[o + 2]!];
}

function allPixels(bitmap: Bitmap): Rgb[] {
  const out: Rgb[] = [];
  for (let y = 0; y < bitmap.height; y++) for (let x = 0; x < bitmap.width; x++) out.push(pixel(bitmap, x, y));
  return out;
}

async function errorOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    const value = await run();
    return isFailure(value) ? value.error : null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? filesUnder(p) : [p];
  });
}

function load(): ImagingBlock {
  jest.resetModules();
  return require('../src/blocks/imaging/index') as ImagingBlock;
}

const RED: Rgb = [220, 30, 40];
const BLUE: Rgb = [20, 60, 210];
const GREEN: Rgb = [30, 200, 60];

// A 4 × 4 image with a different colour in every pixel.
const colourful = (x: number, y: number): Rgb => [40 + x * 60, 20 + y * 70, 230 - (x + y) * 25];

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_USE_FAKES;
});

describe('F004 imaging block', () => {
  it('Applying "grayscale" to a 4 × 4 test image returns a new image whose pixels have equal red, green and blue values, and the input file is unchanged.', async () => {
    const block = load();
    const input = writeImage(4, 4, colourful);
    const before = bytesOf(input);

    const output = expectImage(await block.applyFilter(input, 'grayscale'));

    expect(output.path).not.toBe(input.path);
    const bitmap = pixelsOf(output);
    expect({ width: bitmap.width, height: bitmap.height }).toEqual({ width: 4, height: 4 });
    for (const [r, g, b] of allPixels(bitmap)) expect({ r, g, b }).toEqual({ r, g: r, b: r });
    expect(new Set(allPixels(bitmap).map(([r]) => r)).size).toBeGreaterThan(1);
    expect(bytesOf(input).equals(before)).toBe(true);
  });

  it('Applying "blackwhite" returns a new image whose pixels are only pure black or pure white, and "original" returns the input unchanged.', async () => {
    const block = load();
    // Dark pixels on the left, light pixels on the right, all tinted.
    const input = writeImage(4, 4, (x, y) => (x < 2 ? [30 + y * 5, 20, 45] : [235, 225 - y * 5, 240]));
    const before = bytesOf(input);

    const bw = expectImage(await block.applyFilter(input, 'blackwhite'));
    expect(bw.path).not.toBe(input.path);
    const bwPixels = pixelsOf(bw);
    expect({ width: bwPixels.width, height: bwPixels.height }).toEqual({ width: 4, height: 4 });
    for (const rgb of allPixels(bwPixels)) {
      expect([
        [0, 0, 0],
        [255, 255, 255],
      ]).toContainEqual(rgb);
    }
    expect(pixel(bwPixels, 0, 0)).toEqual([0, 0, 0]);
    expect(pixel(bwPixels, 3, 3)).toEqual([255, 255, 255]);
    expect(bytesOf(input).equals(before)).toBe(true);

    const colourfulInput = writeImage(4, 4, colourful);
    const colourfulBefore = bytesOf(colourfulInput);
    const original = expectImage(await block.applyFilter(colourfulInput, 'original'));
    const originalPixels = pixelsOf(original);
    expect({ width: originalPixels.width, height: originalPixels.height }).toEqual({ width: 4, height: 4 });
    expect(allPixels(originalPixels)).toEqual(allPixels(decodePng(colourfulBefore)));
    expect(bytesOf(colourfulInput).equals(colourfulBefore)).toBe(true);
  });

  it('crop(image, rect) returns an image exactly the rect\'s size, and a rect reaching outside the image returns the error "bad-rect".', async () => {
    const block = load();
    const input = writeImage(10, 8, colourful);
    const before = bytesOf(input);

    for (const rect of [
      { x: 2, y: 1, width: 5, height: 4 },
      { x: 0, y: 0, width: 10, height: 8 },
      { x: 9, y: 7, width: 1, height: 1 },
    ]) {
      const output = expectImage(await block.crop(input, rect));
      expect(output.path).not.toBe(input.path);
      expect({ rect, size: sizeOf(output) }).toEqual({ rect, size: { width: rect.width, height: rect.height } });
    }

    for (const rect of [
      { x: -1, y: 0, width: 5, height: 4 },
      { x: 0, y: -1, width: 5, height: 4 },
      { x: 6, y: 0, width: 5, height: 4 },
      { x: 0, y: 5, width: 5, height: 4 },
      { x: 0, y: 0, width: 11, height: 8 },
      { x: 12, y: 10, width: 2, height: 2 },
    ]) {
      const filesBefore = filesUnder(mockRoot).sort();
      expect({ rect, error: await errorOf(() => block.crop(input, rect)) }).toEqual({ rect, error: 'bad-rect' });
      expect({ rect, files: filesUnder(mockRoot).sort() }).toEqual({ rect, files: filesBefore });
    }
    expect(bytesOf(input).equals(before)).toBe(true);
  });

  it('splitHalves(image) returns the left half then the right half, and their widths add up to the original width.', async () => {
    const block = load();
    for (const width of [8, 9]) {
      // Red on the left, blue on the right; with an odd width the middle column is green.
      const middle = (width - 1) / 2;
      const input = writeImage(width, 6, (x) => (x === middle ? GREEN : x < width / 2 ? RED : BLUE));
      const before = bytesOf(input);

      const halves = await block.splitHalves(input);
      if (isFailure(halves)) throw new Error(`expected two images, got the error "${halves.error}"`);
      expect(halves).toHaveLength(2);
      const [left, right] = halves.map(expectImage) as [Image, Image];
      expect(left.path).not.toBe(right.path);

      const l = pixelsOf(left);
      const r = pixelsOf(right);
      expect({ width, sum: l.width + r.width }).toEqual({ width, sum: width });
      expect(Math.abs(l.width - r.width)).toBeLessThanOrEqual(1);
      expect([l.height, r.height]).toEqual([6, 6]);
      expect(pixel(l, 0, 0)).toEqual(RED);
      expect(pixel(r, r.width - 1, 5)).toEqual(BLUE);
      expect(bytesOf(input).equals(before)).toBe(true);
    }
  });

  it('stack(top, bottom) returns one image as tall as both together and as wide as the wider one.', async () => {
    const block = load();
    const cases: [[number, number], [number, number]][] = [
      [[6, 3], [4, 5]],
      [[4, 5], [6, 3]],
      [[5, 2], [5, 7]],
    ];
    for (const [[tw, th], [bw, bh]] of cases) {
      const top = writeImage(tw, th, () => RED);
      const bottom = writeImage(bw, bh, () => BLUE);
      const topBefore = bytesOf(top);
      const bottomBefore = bytesOf(bottom);

      const output = expectImage(await block.stack(top, bottom));
      expect([top.path, bottom.path]).not.toContain(output.path);

      const bitmap = pixelsOf(output);
      const expected = { width: Math.max(tw, bw), height: th + bh };
      expect({ top: [tw, th], bottom: [bw, bh], size: { width: bitmap.width, height: bitmap.height } }).toEqual({
        top: [tw, th],
        bottom: [bw, bh],
        size: expected,
      });
      expect(pixel(bitmap, 0, 0)).toEqual(RED);
      expect(pixel(bitmap, 0, bitmap.height - 1)).toEqual(BLUE);
      expect(bytesOf(top).equals(topBefore)).toBe(true);
      expect(bytesOf(bottom).equals(bottomBefore)).toBe(true);
    }
  });

  it('resize(image, 1600, 0.4) returns a JPEG whose longest side is 1600 pixels when the input is larger, and leaves a smaller image at its own size.', async () => {
    const block = load();
    const gradient = (x: number, y: number): Rgb => [x % 256, y % 256, (x + y) % 256];

    const cases: [number, number, number, number][] = [
      [2400, 1800, 1600, 1200],
      [1000, 2500, 640, 1600],
    ];
    for (const [w, h, ew, eh] of cases) {
      const input = writeImage(w, h, gradient);
      const before = bytesOf(input);

      const output = expectImage(await block.resize(input, 1600, 0.4));
      expect(output.path).not.toBe(input.path);
      const buf = bytesOf(output);
      expect({ input: [w, h], jpeg: isJpeg(buf) }).toEqual({ input: [w, h], jpeg: true });
      const size = sizeOf(output);
      expect({ input: [w, h], longest: Math.max(size.width, size.height) }).toEqual({ input: [w, h], longest: 1600 });
      expect(Math.abs(size.width - ew)).toBeLessThanOrEqual(1);
      expect(Math.abs(size.height - eh)).toBeLessThanOrEqual(1);
      expect(bytesOf(input).equals(before)).toBe(true);

      // A JPEG already within the limit keeps its size.
      const again = expectImage(await block.resize(output, 1600, 0.4));
      expect(sizeOf(again)).toEqual(size);
    }

    const smaller: [number, number][] = [
      [800, 600],
      [1600, 900],
    ];
    for (const [w, h] of smaller) {
      const input = writeImage(w, h, gradient);
      const before = bytesOf(input);
      const output = expectImage(await block.resize(input, 1600, 0.4));
      expect({ input: [w, h], size: sizeOf(output) }).toEqual({ input: [w, h], size: { width: w, height: h } });
      expect(bytesOf(input).equals(before)).toBe(true);
    }
  });
});
