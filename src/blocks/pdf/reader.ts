// Reads the text of each page of a PDF. It finds objects by scanning for "n g obj" rather than
// trusting the cross-reference table, reads compressed object streams, decrypts files written
// with the standard security handler, revision 6, and extracts the text shown by each page's
// content stream: visible text and invisible text layers alike.
import {
  indexOf,
  isDict,
  isName,
  isRef,
  isRegular,
  isStream,
  isString,
  lastIndexOf,
  latin1String,
  Parser,
  type PdfDict,
  type PdfStream,
  type PdfValue,
} from './objects';
import { decryptData, permsMatch, unlock } from './security';
import { inflate } from './zlib';

export type ReadError = 'bad-pdf' | 'password-required' | 'wrong-password' | 'unsupported-encryption';

export class ReadFailure extends Error {
  constructor(readonly code: ReadError) {
    super(code);
  }
}

// WinAnsiEncoding codes 0x80–0x9F; the rest of the simple-font codes read as Latin-1.
const WIN_ANSI: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹',
  0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™',
  0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

class Document {
  readonly objects = new Map<number, PdfValue>();
  trailer: PdfDict = new Map();
  private fileKey: Uint8Array | null = null;
  private readonly encrypted = new WeakSet<PdfStream>();

  constructor(buf: Uint8Array) {
    const text = latin1String(buf);
    const header = /(\d+)\s+(\d+)\s+obj\b/g;
    for (let m = header.exec(text); m; m = header.exec(text)) {
      try {
        const parser = new Parser(buf, m.index + m[0].length);
        this.objects.set(Number(m[1]), parser.value());
        header.lastIndex = parser.pos;
      } catch {
        // Not an object after all.
      }
    }
    const at = lastIndexOf(buf, 'trailer');
    if (at >= 0) {
      try {
        const t = new Parser(buf, at + 'trailer'.length).value();
        if (isDict(t)) this.trailer = t;
      } catch {
        // Falls back to a cross-reference stream below.
      }
    }
    if (!this.trailer.has('Root')) {
      const xrefs = [...this.objects.values()].filter((v): v is PdfStream => isStream(v) && this.name(v.dict.get('Type')) === 'XRef');
      const last = xrefs[xrefs.length - 1];
      if (last) this.trailer = last.dict;
    }
  }

  resolve(value: PdfValue | undefined): PdfValue | undefined {
    let v = value;
    for (let hops = 0; isRef(v) && hops < 100; hops++) v = this.objects.get(v.ref);
    return v;
  }

  get(d: PdfDict, key: string): PdfValue | undefined {
    return this.resolve(d.get(key));
  }

  name(value: PdfValue | undefined): string | undefined {
    const v = this.resolve(value);
    return isName(v) ? v.name : undefined;
  }

  bytes(value: PdfValue | undefined): Uint8Array {
    const v = this.resolve(value);
    return isString(v) ? v.bytes : new Uint8Array(0);
  }

  // Decrypts every string and stream in place, except the /Encrypt dictionary itself and
  // cross-reference streams, which are never encrypted.
  decrypt(fileKey: Uint8Array, skip: PdfValue | undefined, encryptMetadata: boolean): void {
    const walk = (v: PdfValue): PdfValue => {
      if (isString(v)) {
        try {
          return { bytes: decryptData(fileKey, v.bytes) };
        } catch {
          return v;
        }
      }
      if (Array.isArray(v)) return v.map(walk);
      if (isDict(v)) return new Map([...v].map(([k, x]) => [k, walk(x)]));
      if (isStream(v)) {
        const type = this.name(v.dict.get('Type'));
        if (type === 'XRef' || (type === 'Metadata' && !encryptMetadata)) return v;
        // Stream data is decrypted when it is read, so page images are never decrypted.
        const stream = { dict: walk(v.dict) as PdfDict, data: v.data };
        this.encrypted.add(stream);
        return stream;
      }
      return v;
    };
    for (const [num, value] of this.objects) {
      if (value === skip) continue;
      this.objects.set(num, walk(value));
    }
    this.fileKey = fileKey;
  }

  // Objects kept in compressed object streams; read after decryption.
  expandObjectStreams(): void {
    for (const value of [...this.objects.values()]) {
      if (!isStream(value) || this.name(value.dict.get('Type')) !== 'ObjStm') continue;
      const data = this.decoded(value);
      if (!data) continue;
      const count = Number(this.get(value.dict, 'N'));
      const first = Number(this.get(value.dict, 'First'));
      const numbers = latin1String(data, 0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i < count; i++) {
        const num = numbers[2 * i]!;
        if (this.objects.has(num)) continue;
        try {
          this.objects.set(num, new Parser(data, first + numbers[2 * i + 1]!).value());
        } catch {
          // Skips an object that does not parse.
        }
      }
    }
  }

  // The stream's data with its filters undone, or null when a filter is not supported.
  decoded(stream: PdfStream): Uint8Array | null {
    const filter = this.get(stream.dict, 'Filter');
    const filters = Array.isArray(filter) ? filter : filter === undefined || filter === null ? [] : [filter];
    let data = stream.data;
    if (this.fileKey && this.encrypted.has(stream)) {
      try {
        data = decryptData(this.fileKey, data);
      } catch {
        return null;
      }
    }
    for (const f of filters) {
      const n = this.name(f);
      if (n !== 'FlateDecode' && n !== 'Fl') return null;
      try {
        data = inflate(data);
      } catch {
        return null;
      }
    }
    return data;
  }

  pages(): PdfDict[] {
    const catalog = this.get(this.trailer, 'Root');
    const root = isDict(catalog) ? this.get(catalog, 'Pages') : undefined;
    if (!isDict(root)) throw new ReadFailure('bad-pdf');
    const out: PdfDict[] = [];
    const seen = new Set<PdfDict>();
    const walk = (node: PdfValue | undefined, resources: PdfValue | undefined): void => {
      if (!isDict(node) || seen.has(node)) return;
      seen.add(node);
      const own = this.get(node, 'Resources') ?? resources;
      if (this.name(node.get('Type')) === 'Pages' || node.has('Kids')) {
        const kids = this.get(node, 'Kids');
        for (const kid of Array.isArray(kids) ? kids : []) walk(this.resolve(kid), own);
      } else out.push(new Map([...node, ['Resources', own ?? null]]));
    };
    walk(root, undefined);
    return out;
  }
}

type FontDecoder = { bytesPerCode: 1 | 2; map: Map<number, string> | null };

// bfchar and bfrange entries of a ToUnicode CMap.
function parseCMap(data: Uint8Array): Map<number, string> {
  const map = new Map<number, string>();
  const utf16 = (b: Uint8Array): string => {
    let s = '';
    for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i]! << 8) | b[i + 1]!);
    return s;
  };
  const code = (b: Uint8Array): number => b.reduce((n, x) => n * 256 + x, 0);
  const parser = new Parser(data);
  const stack: PdfValue[] = [];
  let mode: 'char' | 'range' | null = null;
  while (!parser.atEnd()) {
    let t: ReturnType<Parser['token']>;
    try {
      t = parser.token();
    } catch {
      break;
    }
    if (typeof t === 'object' && t !== null && 'keyword' in t) {
      const k = t.keyword;
      if (k === 'beginbfchar') mode = 'char';
      else if (k === 'beginbfrange') mode = 'range';
      else if (k === 'endbfchar' || k === 'endbfrange') mode = null;
      stack.length = 0;
      continue;
    }
    if (!mode) continue;
    stack.push(t);
    if (mode === 'char' && stack.length === 2) {
      const [src, dst] = stack as [PdfValue, PdfValue];
      if (isString(src) && isString(dst)) map.set(code(src.bytes), utf16(dst.bytes));
      stack.length = 0;
    } else if (mode === 'range' && stack.length === 3) {
      const [lo, hi, dst] = stack as [PdfValue, PdfValue, PdfValue];
      if (isString(lo) && isString(hi)) {
        const [a, b] = [code(lo.bytes), code(hi.bytes)];
        for (let c = a; c <= b && c - a < 65536; c++) {
          if (isString(dst)) {
            // The destination plus the offset into the range, carrying across bytes.
            const base = dst.bytes.slice();
            let carry = c - a;
            for (let i = base.length - 1; i >= 0 && carry; i--) {
              const sum = base[i]! + carry;
              base[i] = sum & 0xff;
              carry = sum >> 8;
            }
            map.set(c, utf16(base));
          } else if (Array.isArray(dst) && isString(dst[c - a])) map.set(c, utf16((dst[c - a] as { bytes: Uint8Array }).bytes));
        }
      }
      stack.length = 0;
    }
  }
  return map;
}

function fontDecoder(doc: Document, font: PdfValue | undefined): FontDecoder {
  const d = doc.resolve(font);
  if (!isDict(d)) return { bytesPerCode: 1, map: null };
  const toUnicode = doc.get(d, 'ToUnicode');
  let map: Map<number, string> | null = null;
  if (isStream(toUnicode)) {
    const data = doc.decoded(toUnicode);
    if (data) map = parseCMap(data);
  }
  return { bytesPerCode: doc.name(d.get('Subtype')) === 'Type0' ? 2 : 1, map };
}

function decodeText(bytes: Uint8Array, font: FontDecoder): string {
  let out = '';
  if (font.bytesPerCode === 2) {
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const c = (bytes[i]! << 8) | bytes[i + 1]!;
      out += font.map?.get(c) ?? String.fromCharCode(c);
    }
    return out;
  }
  for (const b of bytes) out += font.map?.get(b) ?? WIN_ANSI[b] ?? String.fromCharCode(b);
  return out;
}

function pageText(doc: Document, page: PdfDict): string {
  const contents = doc.get(page, 'Contents');
  const parts = (Array.isArray(contents) ? contents : [contents]).map((c) => doc.resolve(c)).filter(isStream);
  const decoded = parts.map((s) => doc.decoded(s)).filter((d): d is Uint8Array => d !== null);
  if (decoded.length === 0) return '';
  const data = new Uint8Array(decoded.reduce((n, d) => n + d.length + 1, 0));
  let at = 0;
  for (const d of decoded) {
    data.set(d, at);
    data[at + d.length] = 10;
    at += d.length + 1;
  }

  const resources = doc.resolve(page.get('Resources'));
  const fonts = isDict(resources) ? doc.get(resources, 'Font') : undefined;
  const decoders = new Map<string, FontDecoder>();
  let font: FontDecoder = { bytesPerCode: 1, map: null };
  let out = '';
  let emitted = false;
  const newline = (): void => {
    if (emitted) out += '\n';
  };
  const show = (bytes: Uint8Array): void => {
    out += decodeText(bytes, font);
    emitted = true;
  };

  const parser = new Parser(data);
  const operands: PdfValue[] = [];
  while (!parser.atEnd()) {
    let t: ReturnType<Parser['token']>;
    try {
      t = parser.token();
    } catch {
      break;
    }
    if (!(typeof t === 'object' && t !== null && 'keyword' in t)) {
      operands.push(t);
      continue;
    }
    const op = t.keyword;
    if (op === 'BI') {
      // Inline image: skip its binary data up to EI.
      const id = indexOf(data, 'ID', parser.pos);
      let ei = id < 0 ? -1 : indexOf(data, 'EI', id + 3);
      while (ei > 0 && (isRegular(data[ei - 1]!) || isRegular(data[ei + 2] ?? -1))) ei = indexOf(data, 'EI', ei + 2);
      parser.pos = ei < 0 ? data.length : ei + 2;
    } else if (op === 'BT') {
      if (out && !out.endsWith('\n')) out += '\n';
      emitted = false;
    } else if (op === 'Tf') {
      const n = operands[operands.length - 2];
      if (isName(n)) {
        if (!decoders.has(n.name)) decoders.set(n.name, fontDecoder(doc, isDict(fonts) ? fonts.get(n.name) : undefined));
        font = decoders.get(n.name)!;
      }
    } else if (op === 'Tj') {
      const s = operands[operands.length - 1];
      if (isString(s)) show(s.bytes);
    } else if (op === "'" || op === '"') {
      newline();
      const s = operands[operands.length - 1];
      if (isString(s)) show(s.bytes);
    } else if (op === 'TJ') {
      const items = operands[operands.length - 1];
      for (const item of Array.isArray(items) ? items : []) {
        if (isString(item)) show(item.bytes);
        else if (typeof item === 'number' && item < -200) out += ' ';
      }
    } else if (op === 'T*') {
      out += '\n';
    } else if (op === 'Td' || op === 'TD') {
      const ty = operands[operands.length - 1];
      if (typeof ty === 'number' && ty !== 0) newline();
    } else if (op === 'Tm') {
      newline();
    }
    operands.length = 0;
  }
  return out;
}

export function readPdfText(bytes: Uint8Array, password?: string): string[] {
  if (latin1String(bytes, 0, Math.min(bytes.length, 1024)).indexOf('%PDF-') < 0) throw new ReadFailure('bad-pdf');
  const doc = new Document(bytes);
  const encrypt = doc.get(doc.trailer, 'Encrypt');
  if (isDict(encrypt)) {
    const [filter, v, r] = [doc.name(encrypt.get('Filter')), doc.get(encrypt, 'V'), doc.get(encrypt, 'R')];
    if (filter !== 'Standard' || v !== 5 || r !== 6) throw new ReadFailure('unsupported-encryption');
    const values = { O: doc.bytes(encrypt.get('O')), U: doc.bytes(encrypt.get('U')), OE: doc.bytes(encrypt.get('OE')), UE: doc.bytes(encrypt.get('UE')) };
    // Without a password, try the empty one: a file with only an owner password opens with it.
    const fileKey = unlock(password ?? '', values);
    if (!fileKey) throw new ReadFailure(password ? 'wrong-password' : 'password-required');
    if (!permsMatch(fileKey, doc.bytes(encrypt.get('Perms')), Number(doc.get(encrypt, 'P')))) throw new ReadFailure('bad-pdf');
    doc.decrypt(fileKey, encrypt, doc.get(encrypt, 'EncryptMetadata') !== false);
  }
  doc.expandObjectStreams();
  return doc.pages().map((page) => pageText(doc, page));
}
