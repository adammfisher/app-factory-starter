import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

// The contract these tests hold the pdf block to:
// - src/blocks/pdf/index.web.ts is the pdf-lib implementation (SPEC.md decision for R-008: pdf-lib
//   is the web and test implementation), and these tests run it. It exports:
//   - write(pages, options?): pages is a list of { image, text? }, one per page, in page order;
//     image is { path, width, height } (path a file:// URI to a PNG or JPEG, size in pixels);
//     text is that page's invisible text layer. options is { pageSize?, password? } where pageSize
//     is "letter" | "a4" | "auto" and password is 4 to 64 characters. Resolves { path } where path
//     is a file:// URI to one new .pdf file.
//   - readText(path, password?): resolves one string per page, in page order ("" for a page with
//     no text), or { error: "password-required" } for a password-protected PDF read without
//     the right password.
// - A password-protected PDF uses the PDF standard security handler (the file has an /Encrypt
//   entry), so the text is protected by the file itself, not by anything stored beside it.
// - Errors resolve { error: "<code>" } and write nothing.
// - The block reads and writes files through expo-file-system (the default export or
//   expo-file-system/legacy).

type Image = { path: string; width: number; height: number };
type Page = { image: Image; text?: string };
type PageSize = 'letter' | 'a4' | 'auto';
type WriteOptions = { pageSize?: PageSize; password?: string };
type Written = { path: string };
type Failure = { error: string };
type PdfBlock = {
  write: (pages: Page[], options?: WriteOptions) => Promise<Written | Failure>;
  readText: (path: string, password?: string) => Promise<string[] | Failure>;
};
type Rgb = [number, number, number];

jest.setTimeout(60_000);

// Named mock… so jest.mock factories may use it.
const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f005-'));
const INPUTS = path.join(mockRoot, 'inputs');
const ELSEWHERE = fs.mkdtempSync(path.join(os.tmpdir(), 'f005-elsewhere-'));
fs.mkdirSync(INPUTS, { recursive: true });
afterAll(() => {
  fs.rmSync(mockRoot, { recursive: true, force: true });
  fs.rmSync(ELSEWHERE, { recursive: true, force: true });
});

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

// --- A small PNG encoder, so the tests depend on nothing the block might use.

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

function encodePng(width: number, height: number, colour: Rgb): Buffer {
  const chunk = (type: string, body: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(colour, y * (stride + 1) + 1 + x * 3);
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// --- A small PDF reader: enough of the object syntax to walk the page tree, including objects
// kept in compressed object streams. It does not read encrypted files.

type Name = { name: string };
type Ref = { ref: number };
type Dict = Map<string, PdfValue>;
type Stream = { dict: Dict; data: Buffer };
type PdfValue = number | boolean | null | string | Name | Ref | PdfValue[] | Dict | Stream;
type PdfPage = { width: number; height: number; images: { width: number; height: number }[]; content: string };

const isObject = (v: unknown): v is object => typeof v === 'object' && v !== null;
const isName = (v: unknown): v is Name => isObject(v) && !(v instanceof Map) && 'name' in v;
const isRef = (v: unknown): v is Ref => isObject(v) && !(v instanceof Map) && 'ref' in v;
const isDict = (v: unknown): v is Dict => v instanceof Map;
const isStream = (v: unknown): v is Stream => isObject(v) && !(v instanceof Map) && 'dict' in v && 'data' in v;

const WHITESPACE = new Set([0, 9, 10, 12, 13, 32]);
const DELIMITERS = new Set([...'()<>[]{}/%'].map((c) => c.charCodeAt(0)));

class PdfParser {
  constructor(
    private readonly buf: Buffer,
    public pos: number,
  ) {}

  private peek(offset = 0): number {
    return this.buf[this.pos + offset] ?? -1;
  }

  private ascii(length: number): string {
    return this.buf.toString('latin1', this.pos, this.pos + length);
  }

  private skip(): void {
    while (this.pos < this.buf.length) {
      const c = this.peek();
      if (WHITESPACE.has(c)) this.pos++;
      else if (c === 0x25) {
        while (this.pos < this.buf.length && this.peek() !== 10 && this.peek() !== 13) this.pos++;
      } else break;
    }
  }

  value(): PdfValue {
    this.skip();
    const c = this.peek();
    if (c === 0x2f) return { name: this.nameToken() };
    if (c === 0x3c && this.peek(1) === 0x3c) return this.dictOrStream();
    if (c === 0x3c) return this.hexString();
    if (c === 0x28) return this.literalString();
    if (c === 0x5b) return this.array();
    const head = this.ascii(48);
    const ref = /^(\d+)\s+(\d+)\s+R(?![^\s()<>[\]{}/%])/.exec(head);
    if (ref) {
      this.pos += ref[0].length;
      return { ref: Number(ref[1]) };
    }
    const num = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(head);
    if (num) {
      this.pos += num[0].length;
      return Number(num[0]);
    }
    for (const [word, v] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (head.startsWith(word)) {
        this.pos += word.length;
        return v;
      }
    }
    throw new Error(`unexpected PDF token at ${this.pos}: ${JSON.stringify(head.slice(0, 12))}`);
  }

  private nameToken(): string {
    this.pos++;
    const start = this.pos;
    while (this.pos < this.buf.length && !WHITESPACE.has(this.peek()) && !DELIMITERS.has(this.peek())) this.pos++;
    return this.buf
      .toString('latin1', start, this.pos)
      .replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  }

  private dictOrStream(): Dict | Stream {
    this.pos += 2;
    const dict: Dict = new Map();
    for (;;) {
      this.skip();
      if (this.peek() === 0x3e && this.peek(1) === 0x3e) {
        this.pos += 2;
        break;
      }
      if (this.pos >= this.buf.length) throw new Error('unterminated dictionary');
      const key = this.value();
      if (!isName(key)) throw new Error(`dictionary key is not a name at ${this.pos}`);
      dict.set(key.name, this.value());
    }
    const afterDict = this.pos;
    this.skip();
    if (this.ascii(6) !== 'stream') {
      this.pos = afterDict;
      return dict;
    }
    this.pos += 6;
    if (this.peek() === 13) this.pos++;
    if (this.peek() === 10) this.pos++;
    const start = this.pos;
    const length = dict.get('Length');
    let end: number;
    if (typeof length === 'number' && this.buf.toString('latin1', start + length, start + length + 32).includes('endstream')) {
      end = start + length;
    } else {
      end = this.buf.indexOf('endstream', start, 'latin1');
      if (end < 0) throw new Error('unterminated stream');
      while (end > start && (this.buf[end - 1] === 10 || this.buf[end - 1] === 13)) end--;
    }
    const data = this.buf.subarray(start, end);
    this.pos = this.buf.indexOf('endstream', end, 'latin1') + 'endstream'.length;
    return { dict, data };
  }

  private hexString(): string {
    const end = this.buf.indexOf(0x3e, this.pos);
    let hex = this.buf.toString('latin1', this.pos + 1, end).replace(/\s+/g, '');
    if (hex.length % 2) hex += '0';
    this.pos = end + 1;
    return Buffer.from(hex, 'hex').toString('latin1');
  }

  private literalString(): string {
    this.pos++;
    const escapes: Record<number, string> = { 0x6e: '\n', 0x72: '\r', 0x74: '\t', 0x62: '\b', 0x66: '\f' };
    let depth = 1;
    let out = '';
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos++]!;
      if (c === 0x5c) {
        const n = this.buf[this.pos++]!;
        if (escapes[n] !== undefined) out += escapes[n];
        else if (n >= 0x30 && n <= 0x37) {
          let oct = String.fromCharCode(n);
          while (oct.length < 3 && this.peek() >= 0x30 && this.peek() <= 0x37) oct += String.fromCharCode(this.buf[this.pos++]!);
          out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        } else if (n === 13) {
          if (this.peek() === 10) this.pos++;
        } else if (n !== 10) out += String.fromCharCode(n);
      } else if (c === 0x28) {
        depth++;
        out += '(';
      } else if (c === 0x29) {
        if (--depth === 0) break;
        out += ')';
      } else out += String.fromCharCode(c);
    }
    return out;
  }

  private array(): PdfValue[] {
    this.pos++;
    const items: PdfValue[] = [];
    for (;;) {
      this.skip();
      if (this.peek() === 0x5d) {
        this.pos++;
        return items;
      }
      if (this.pos >= this.buf.length) throw new Error('unterminated array');
      items.push(this.value());
    }
  }
}

class PdfDocument {
  private readonly objects = new Map<number, PdfValue>();

  constructor(buf: Buffer) {
    const text = buf.toString('latin1');
    const header = /(\d+)\s+(\d+)\s+obj\b/g;
    for (let m = header.exec(text); m; m = header.exec(text)) {
      try {
        const parser = new PdfParser(buf, m.index + m[0].length);
        this.objects.set(Number(m[1]), parser.value());
        header.lastIndex = parser.pos;
      } catch {
        // Not an object after all.
      }
    }
    for (const value of [...this.objects.values()]) {
      if (!isStream(value) || this.name(value.dict.get('Type')) !== 'ObjStm') continue;
      const data = this.decoded(value);
      const count = Number(this.get(value.dict, 'N'));
      const first = Number(this.get(value.dict, 'First'));
      const numbers = data.toString('latin1', 0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i < count; i++) {
        const num = numbers[2 * i]!;
        if (!this.objects.has(num)) this.objects.set(num, new PdfParser(data, first + numbers[2 * i + 1]!).value());
      }
    }
  }

  resolve(value: PdfValue | undefined): PdfValue | undefined {
    let v = value;
    for (let hops = 0; isRef(v) && hops < 100; hops++) v = this.objects.get(v.ref);
    return v;
  }

  get(dict: Dict, key: string): PdfValue | undefined {
    return this.resolve(dict.get(key));
  }

  name(value: PdfValue | undefined): string | undefined {
    const v = this.resolve(value);
    return isName(v) ? v.name : undefined;
  }

  decoded(stream: Stream): Buffer {
    const filter = this.get(stream.dict, 'Filter');
    const filters = Array.isArray(filter) ? filter : filter === undefined ? [] : [filter];
    let data = stream.data;
    for (const f of filters) {
      const name = this.name(f);
      if (name === 'FlateDecode') data = zlib.inflateSync(data);
      else throw new Error(`unsupported PDF filter ${name}`);
    }
    return data;
  }

  pages(): PdfPage[] {
    const catalog = [...this.objects.values()].find((v): v is Dict => isDict(v) && this.name(v.get('Type')) === 'Catalog');
    if (!catalog) throw new Error('PDF has no catalog');
    const out: PdfPage[] = [];
    const walk = (node: PdfValue | undefined, inherited: Dict): void => {
      if (!isDict(node)) throw new Error('page tree node is not a dictionary');
      const merged: Dict = new Map(inherited);
      for (const key of ['MediaBox', 'Resources', 'Rotate']) {
        const v = node.get(key);
        if (v !== undefined) merged.set(key, v);
      }
      if (this.name(node.get('Type')) === 'Pages') {
        const kids = this.get(node, 'Kids');
        for (const kid of Array.isArray(kids) ? kids : []) walk(this.resolve(kid), merged);
      } else out.push(this.page(node, merged));
    };
    walk(this.get(catalog, 'Pages'), new Map());
    return out;
  }

  private page(node: Dict, inherited: Dict): PdfPage {
    const box = this.get(inherited, 'MediaBox');
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = (Array.isArray(box) ? box : []).map((v) => Number(this.resolve(v)));
    let width = Math.abs(x2 - x1);
    let height = Math.abs(y2 - y1);
    const rotate = ((Number(this.get(inherited, 'Rotate') ?? 0) % 360) + 360) % 360;
    if (rotate % 180 === 90) [width, height] = [height, width];
    return { width, height, images: this.imagesIn(this.get(inherited, 'Resources'), 0), content: this.contentOf(node) };
  }

  private imagesIn(resources: PdfValue | undefined, depth: number): { width: number; height: number }[] {
    if (!isDict(resources) || depth > 4) return [];
    const xobjects = this.get(resources, 'XObject');
    if (!isDict(xobjects)) return [];
    return [...xobjects.values()].flatMap((v) => {
      const x = this.resolve(v);
      if (!isStream(x)) return [];
      const subtype = this.name(x.dict.get('Subtype'));
      if (subtype === 'Image') return [{ width: Number(this.get(x.dict, 'Width')), height: Number(this.get(x.dict, 'Height')) }];
      if (subtype === 'Form') return this.imagesIn(this.get(x.dict, 'Resources'), depth + 1);
      return [];
    });
  }

  private contentOf(node: Dict): string {
    const contents = this.get(node, 'Contents');
    const parts = Array.isArray(contents) ? contents : contents === undefined ? [] : [contents];
    return parts
      .map((p) => this.resolve(p))
      .filter(isStream)
      .map((s) => this.decoded(s).toString('latin1'))
      .join('\n');
  }
}

// --- Test images and result helpers.

let counter = 0;
function writeImage(width: number, height: number, colour: Rgb): Image {
  const file = path.join(INPUTS, `input-${++counter}.png`);
  fs.writeFileSync(file, encodePng(width, height, colour));
  return { path: `file://${file}`, width, height };
}

function fileOf(uri: string): string {
  return decodeURI(uri.replace(/^file:\/\//, ''));
}

function isFailure(value: unknown): value is Failure {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as Failure).error === 'string';
}

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? filesUnder(p) : [p];
  });
}

// Runs write and checks it made exactly one new PDF file, and nothing else.
async function writePdf(block: PdfBlock, pages: Page[], options?: WriteOptions): Promise<{ uri: string; bytes: Buffer }> {
  const before = new Set(filesUnder(mockRoot));
  const result = await block.write(pages, options);
  if (isFailure(result)) throw new Error(`expected a PDF, got the error "${result.error}"`);
  expect(typeof result.path).toBe('string');
  expect(result.path).toMatch(/\.pdf$/i);
  const file = fileOf(result.path);
  expect(filesUnder(mockRoot).filter((f) => !before.has(f))).toEqual([file]);
  const bytes = fs.readFileSync(file);
  expect(bytes.toString('latin1', 0, 5)).toBe('%PDF-');
  return { uri: result.path, bytes };
}

async function textOf(block: PdfBlock, uri: string, password?: string): Promise<string[]> {
  const result = password === undefined ? await block.readText(uri) : await block.readText(uri, password);
  if (isFailure(result)) throw new Error(`expected the text of each page, got the error "${result.error}"`);
  expect(Array.isArray(result)).toBe(true);
  return result.map((t) => t.trim());
}

// A copy of the PDF in a folder the block never wrote to, so readText can only use the PDF itself.
function copyElsewhere(uri: string): string {
  const target = path.join(ELSEWHERE, `copy-${++counter}.pdf`);
  fs.copyFileSync(fileOf(uri), target);
  return `file://${target}`;
}

function load(): PdfBlock {
  jest.resetModules();
  return require('../src/blocks/pdf/index.web') as PdfBlock;
}

const RED: Rgb = [220, 30, 40];
const BLUE: Rgb = [20, 60, 210];
const GREEN: Rgb = [30, 200, 60];
const INVOICE = 'Invoice 4417';

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_USE_FAKES;
});

describe('F005 pdf block', () => {
  it('write of 3 page images produces one PDF with 3 pages in the given order.', async () => {
    const block = load();
    // Each image has its own pixel size, so each page's image can be told apart.
    const a = writeImage(30, 40, RED);
    const b = writeImage(50, 20, BLUE);
    const c = writeImage(24, 24, GREEN);

    for (const order of [
      [a, b, c],
      [c, a, b],
    ]) {
      const { bytes } = await writePdf(
        block,
        order.map((image) => ({ image })),
      );
      const pages = new PdfDocument(bytes).pages();
      expect(pages).toHaveLength(3);
      expect(pages.map((p) => p.images[0] ?? null)).toEqual(order.map(({ width, height }) => ({ width, height })));
    }
  });

  it('With the text "Invoice 4417" given for page 2, readText of the PDF returns "Invoice 4417" for page 2.', async () => {
    const block = load();
    const { uri, bytes } = await writePdf(block, [
      { image: writeImage(30, 40, RED) },
      { image: writeImage(30, 40, BLUE), text: INVOICE },
      { image: writeImage(30, 40, GREEN) },
    ]);

    expect(await textOf(block, uri)).toEqual(['', INVOICE, '']);
    expect(await textOf(block, copyElsewhere(uri))).toEqual(['', INVOICE, '']);

    // The text is a text layer drawn on page 2 of the PDF, and only there.
    const pages = new PdfDocument(bytes).pages();
    expect(pages.map((p) => /\bBT\b/.test(p.content))).toEqual([false, true, false]);
  });

  it('Page size "letter" gives pages of 612 × 792 points, "a4" gives 595 × 842 points, and "auto" gives each page its image\'s aspect ratio.', async () => {
    const block = load();
    const images = [writeImage(60, 40, RED), writeImage(40, 80, BLUE), writeImage(32, 32, GREEN)];
    const pages = images.map((image) => ({ image }));
    const sizesOf = (bytes: Buffer) =>
      new PdfDocument(bytes).pages().map((p) => ({ width: Math.round(p.width), height: Math.round(p.height) }));

    const letter = await writePdf(block, pages, { pageSize: 'letter' });
    expect(sizesOf(letter.bytes)).toEqual(images.map(() => ({ width: 612, height: 792 })));

    const a4 = await writePdf(block, pages, { pageSize: 'a4' });
    expect(sizesOf(a4.bytes)).toEqual(images.map(() => ({ width: 595, height: 842 })));

    const auto = await writePdf(block, pages, { pageSize: 'auto' });
    const autoPages = new PdfDocument(auto.bytes).pages();
    expect(autoPages).toHaveLength(3);
    autoPages.forEach((page, i) => {
      const image = images[i]!;
      const ratio = page.width / page.height;
      const expected = image.width / image.height;
      expect({ page: i + 1, ratio: Math.abs(ratio - expected) / expected < 0.005 }).toEqual({ page: i + 1, ratio: true });
    });
  });

  it('With a password of 4 to 64 characters, readText without the password returns the error "password-required", and with it returns the text.', async () => {
    const block = load();
    for (const password of ['k7#q', 'Pw-'.repeat(21) + 'x', 'correct horse battery']) {
      expect(password.length).toBeGreaterThanOrEqual(4);
      expect(password.length).toBeLessThanOrEqual(64);
      const { uri, bytes } = await writePdf(
        block,
        [{ image: writeImage(30, 40, RED) }, { image: writeImage(30, 40, BLUE), text: INVOICE }],
        { password },
      );

      expect({ password, encrypted: bytes.toString('latin1').includes('/Encrypt') }).toEqual({ password, encrypted: true });

      expect(await block.readText(uri)).toEqual({ error: 'password-required' });
      expect(await block.readText(copyElsewhere(uri))).toEqual({ error: 'password-required' });
      expect(isFailure(await block.readText(uri, password + 'x'))).toBe(true);

      expect(await textOf(block, uri, password)).toEqual(['', INVOICE]);
      expect(await textOf(block, copyElsewhere(uri), password)).toEqual(['', INVOICE]);
    }
  });

  it('A password shorter than 4 or longer than 64 characters, or an empty list of pages, returns an error and writes no file.', async () => {
    const block = load();
    const pages = [{ image: writeImage(30, 40, RED), text: INVOICE }];

    const cases: [string, Page[], WriteOptions | undefined][] = [
      ['1-character password', pages, { password: 'a' }],
      ['3-character password', pages, { password: 'k7#' }],
      ['65-character password', pages, { password: 'x'.repeat(65) }],
      ['200-character password', pages, { password: 'y'.repeat(200) }],
      ['empty list of pages', [], undefined],
      ['empty list of pages with a password', [], { password: 'k7#q' }],
      ['empty list of pages as letter', [], { pageSize: 'letter' }],
    ];
    for (const [label, casePages, options] of cases) {
      const before = filesUnder(mockRoot).sort();
      const result = await block.write(casePages, options);
      expect({ label, failed: isFailure(result) }).toEqual({ label, failed: true });
      expect({ label, files: filesUnder(mockRoot).sort() }).toEqual({ label, files: before });
    }
  });
});
