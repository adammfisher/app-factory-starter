// PDF object syntax (ISO 32000, 7.3): the values, a serializer and a parser. Strings are bytes;
// what the bytes mean depends on where the string is used.

export type PdfName = { name: string };
export type PdfRef = { ref: number };
export type PdfString = { bytes: Uint8Array };
export type PdfDict = Map<string, PdfValue>;
export type PdfStream = { dict: PdfDict; data: Uint8Array };
export type PdfValue = number | boolean | null | PdfName | PdfRef | PdfString | PdfValue[] | PdfDict | PdfStream;

const isObject = (v: unknown): v is object => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Map);
export const isName = (v: unknown): v is PdfName => isObject(v) && 'name' in v;
export const isRef = (v: unknown): v is PdfRef => isObject(v) && 'ref' in v;
export const isString = (v: unknown): v is PdfString => isObject(v) && 'bytes' in v;
export const isDict = (v: unknown): v is PdfDict => v instanceof Map;
export const isStream = (v: unknown): v is PdfStream => isObject(v) && 'dict' in v && 'data' in v;

export const name = (n: string): PdfName => ({ name: n });
export const ref = (n: number): PdfRef => ({ ref: n });
export const text = (s: string): PdfString => ({ bytes: latin1Bytes(s) });
export const dict = (entries: Record<string, PdfValue | undefined>): PdfDict =>
  new Map(Object.entries(entries).filter((e): e is [string, PdfValue] => e[1] !== undefined));

export function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function latin1String(bytes: Uint8Array, start = 0, end = bytes.length): string {
  const parts: string[] = [];
  for (let i = start; i < end; i += 8192) {
    parts.push(String.fromCharCode(...bytes.subarray(i, Math.min(end, i + 8192))));
  }
  return parts.join('');
}

// --- Serializer. Strings go out as hex; `crypt`, when given, encrypts each string and stream.

const HEX = '0123456789ABCDEF';
function hex(bytes: Uint8Array): string {
  let out = '<';
  for (const b of bytes) out += HEX[b >> 4]! + HEX[b & 15]!;
  return out + '>';
}

function number(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function nameToken(n: string): string {
  let out = '/';
  for (const ch of n) {
    const c = ch.charCodeAt(0);
    out += c < 0x21 || c > 0x7e || '()<>[]{}/%#'.includes(ch) ? `#${HEX[(c >> 4) & 15]}${HEX[c & 15]}` : ch;
  }
  return out;
}

export type Crypt = (data: Uint8Array) => Uint8Array;

export function serialize(value: PdfValue, crypt?: Crypt): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return number(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map((v) => serialize(v, crypt)).join(' ')}]`;
  if (isDict(value)) return `<<${[...value].map(([k, v]) => `${nameToken(k)} ${serialize(v, crypt)}`).join(' ')}>>`;
  if (isName(value)) return nameToken(value.name);
  if (isRef(value)) return `${value.ref} 0 R`;
  if (isString(value)) return hex(crypt ? crypt(value.bytes) : value.bytes);
  throw new Error('a stream must be an indirect object');
}

// One indirect object, as bytes.
export function serializeObject(num: number, value: PdfValue, crypt?: Crypt): Uint8Array {
  if (!isStream(value)) return latin1Bytes(`${num} 0 obj\n${serialize(value, crypt)}\nendobj\n`);
  const data = crypt ? crypt(value.data) : value.data;
  const head = latin1Bytes(`${num} 0 obj\n${serialize(new Map([...value.dict, ['Length', data.length]]), crypt)}\nstream\n`);
  const tail = latin1Bytes('\nendstream\nendobj\n');
  const out = new Uint8Array(head.length + data.length + tail.length);
  out.set(head);
  out.set(data, head.length);
  out.set(tail, head.length + data.length);
  return out;
}

// --- Parser.

const WHITESPACE = new Set([0, 9, 10, 12, 13, 32]);
const DELIMITERS = new Set([...'()<>[]{}/%'].map((c) => c.charCodeAt(0)));
export const isRegular = (c: number): boolean => c >= 0 && !WHITESPACE.has(c) && !DELIMITERS.has(c);

const ESCAPES: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12 };

export class Parser {
  constructor(
    readonly buf: Uint8Array,
    public pos = 0,
  ) {}

  peek(offset = 0): number {
    return this.buf[this.pos + offset] ?? -1;
  }

  skip(): void {
    while (this.pos < this.buf.length) {
      const c = this.peek();
      if (WHITESPACE.has(c)) this.pos++;
      else if (c === 0x25) {
        while (this.pos < this.buf.length && this.peek() !== 10 && this.peek() !== 13) this.pos++;
      } else break;
    }
  }

  // A run of regular characters: a number, keyword or operator.
  word(): string {
    const start = this.pos;
    while (this.pos < this.buf.length && isRegular(this.peek())) this.pos++;
    return latin1String(this.buf, start, this.pos);
  }

  atEnd(): boolean {
    this.skip();
    return this.pos >= this.buf.length;
  }

  // The next value, or a keyword (as { keyword }) where a content stream has an operator.
  token(): PdfValue | { keyword: string } {
    this.skip();
    const c = this.peek();
    if (c === 0x2f) return name(this.nameToken());
    if (c === 0x3c && this.peek(1) === 0x3c) return this.dictOrStream();
    if (c === 0x3c) return this.hexString();
    if (c === 0x28) return this.literalString();
    if (c === 0x5b) return this.array();
    if (c < 0) throw new Error('unexpected end of PDF data');
    if (!isRegular(c)) {
      this.pos++;
      return { keyword: String.fromCharCode(c) };
    }
    const start = this.pos;
    const w = this.word();
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) {
      // "n g R" is a reference.
      if (/^\d+$/.test(w)) {
        const after = this.pos;
        this.skip();
        const gen = this.word();
        if (/^\d+$/.test(gen)) {
          this.skip();
          if (this.peek() === 0x52 && !isRegular(this.peek(1))) {
            this.pos++;
            return ref(Number(w));
          }
        }
        this.pos = after;
      }
      return Number(w);
    }
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    if (!w) this.pos = start + 1;
    return { keyword: w };
  }

  value(): PdfValue {
    const t = this.token();
    if (isObject(t) && 'keyword' in t) throw new Error(`unexpected keyword ${String(t.keyword)}`);
    return t as PdfValue;
  }

  private nameToken(): string {
    this.pos++;
    return this.word().replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  }

  private dictOrStream(): PdfDict | PdfStream {
    this.pos += 2;
    const d: PdfDict = new Map();
    for (;;) {
      this.skip();
      if (this.peek() === 0x3e && this.peek(1) === 0x3e) {
        this.pos += 2;
        break;
      }
      if (this.pos >= this.buf.length) throw new Error('unterminated dictionary');
      const key = this.value();
      if (!isName(key)) throw new Error('dictionary key is not a name');
      d.set(key.name, this.value());
    }
    const afterDict = this.pos;
    this.skip();
    if (latin1String(this.buf, this.pos, this.pos + 6) !== 'stream') {
      this.pos = afterDict;
      return d;
    }
    this.pos += 6;
    if (this.peek() === 13) this.pos++;
    if (this.peek() === 10) this.pos++;
    const start = this.pos;
    const length = d.get('Length');
    let end = -1;
    if (typeof length === 'number' && latin1String(this.buf, start + length, start + length + 32).includes('endstream')) end = start + length;
    else {
      end = indexOf(this.buf, 'endstream', start);
      if (end < 0) throw new Error('unterminated stream');
      while (end > start && (this.buf[end - 1] === 10 || this.buf[end - 1] === 13)) end--;
    }
    const data = this.buf.subarray(start, end);
    this.pos = indexOf(this.buf, 'endstream', end) + 'endstream'.length;
    return { dict: d, data };
  }

  private hexString(): PdfString {
    this.pos++;
    const digits: number[] = [];
    while (this.pos < this.buf.length && this.peek() !== 0x3e) {
      const v = parseInt(String.fromCharCode(this.buf[this.pos++]!), 16);
      if (!Number.isNaN(v)) digits.push(v);
    }
    this.pos++;
    if (digits.length % 2) digits.push(0);
    const bytes = new Uint8Array(digits.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (digits[2 * i]! << 4) | digits[2 * i + 1]!;
    return { bytes };
  }

  private literalString(): PdfString {
    this.pos++;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < this.buf.length) {
      const c = this.buf[this.pos++]!;
      if (c === 0x5c) {
        const n = this.buf[this.pos++]!;
        if (ESCAPES[n] !== undefined) out.push(ESCAPES[n]!);
        else if (n >= 0x30 && n <= 0x37) {
          let oct = n - 0x30;
          for (let k = 0; k < 2 && this.peek() >= 0x30 && this.peek() <= 0x37; k++) oct = oct * 8 + (this.buf[this.pos++]! - 0x30);
          out.push(oct & 0xff);
        } else if (n === 13) {
          if (this.peek() === 10) this.pos++;
        } else if (n !== 10) out.push(n);
      } else if (c === 0x28) {
        depth++;
        out.push(c);
      } else if (c === 0x29) {
        if (--depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return { bytes: Uint8Array.from(out) };
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

export function indexOf(buf: Uint8Array, word: string, from = 0): number {
  const first = word.charCodeAt(0);
  outer: for (let i = buf.indexOf(first, from); i >= 0 && i <= buf.length - word.length; i = buf.indexOf(first, i + 1)) {
    for (let k = 1; k < word.length; k++) if (buf[i + k] !== word.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
}

export function lastIndexOf(buf: Uint8Array, word: string): number {
  const first = word.charCodeAt(0);
  outer: for (let i = buf.lastIndexOf(first, buf.length - word.length); i >= 0; i = i > 0 ? buf.lastIndexOf(first, i - 1) : -1) {
    for (let k = 1; k < word.length; k++) if (buf[i + k] !== word.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
}
