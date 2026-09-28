// zlib inflate and deflate (RFC 1950/1951) in plain JavaScript, for the PNG codec. Inflate reads
// every block type. Deflate writes one fixed-Huffman block with LZ77 matches: smaller than stored
// blocks and much simpler than dynamic Huffman.

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function reverseBits(code: number, length: number): number {
  let out = 0;
  for (let i = 0; i < length; i++) {
    out = (out << 1) | (code & 1);
    code >>>= 1;
  }
  return out;
}

// A lookup table indexed by the next maxBits input bits (least significant first). Each entry is
// symbol << 4 | code length.
type Table = { entries: Uint32Array; bits: number };

function buildTable(lengths: ArrayLike<number>): Table {
  let bits = 1;
  for (let i = 0; i < lengths.length; i++) bits = Math.max(bits, lengths[i]!);
  const count = new Array<number>(16).fill(0);
  for (let i = 0; i < lengths.length; i++) count[lengths[i]!]!++;
  count[0] = 0;
  const next = new Array<number>(16).fill(0);
  let code = 0;
  for (let len = 1; len < 16; len++) {
    code = (code + count[len - 1]!) << 1;
    next[len] = code;
  }
  const entries = new Uint32Array(1 << bits);
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const len = lengths[symbol]!;
    if (len === 0) continue;
    const reversed = reverseBits(next[len]!++, len);
    for (let i = reversed; i < entries.length; i += 1 << len) entries[i] = (symbol << 4) | len;
  }
  return { entries, bits };
}

let fixedTables: { lit: Table; dist: Table } | null = null;
function fixed(): { lit: Table; dist: Table } {
  if (!fixedTables) {
    const lit = new Uint8Array(288);
    lit.fill(8, 0, 144);
    lit.fill(9, 144, 256);
    lit.fill(7, 256, 280);
    lit.fill(8, 280, 288);
    fixedTables = { lit: buildTable(lit), dist: buildTable(new Uint8Array(30).fill(5)) };
  }
  return fixedTables;
}

export function inflate(input: Uint8Array, sizeHint = 0): Uint8Array {
  if (input.length < 2 || (input[0]! & 0x0f) !== 8 || ((input[0]! << 8) | input[1]!) % 31 !== 0) throw new Error('not zlib data');
  if (input[1]! & 0x20) throw new Error('zlib preset dictionary');
  let pos = 2;
  let bitBuf = 0;
  let bitCount = 0;
  let out = new Uint8Array(Math.max(sizeHint, input.length * 4, 1024));
  let outLen = 0;

  const need = (n: number): void => {
    while (bitCount < n) {
      if (pos > input.length + 4) throw new Error('truncated zlib data');
      bitBuf |= (pos < input.length ? input[pos]! : 0) << bitCount;
      pos++;
      bitCount += 8;
    }
  };
  const bits = (n: number): number => {
    if (n === 0) return 0;
    need(n);
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCount -= n;
    return v;
  };
  const symbol = (table: Table): number => {
    need(table.bits);
    const entry = table.entries[bitBuf & ((1 << table.bits) - 1)]!;
    const len = entry & 15;
    if (len === 0) throw new Error('bad Huffman code');
    bitBuf >>>= len;
    bitCount -= len;
    return entry >>> 4;
  };
  const ensure = (extra: number): void => {
    if (outLen + extra <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, outLen + extra));
    bigger.set(out.subarray(0, outLen));
    out = bigger;
  };

  let final = 0;
  while (!final) {
    final = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0;
      pos -= bitCount >> 3;
      bitCount = 0;
      const len = input[pos]! | (input[pos + 1]! << 8);
      pos += 4;
      if (pos + len > input.length) throw new Error('truncated stored block');
      ensure(len);
      out.set(input.subarray(pos, pos + len), outLen);
      outLen += len;
      pos += len;
      continue;
    }
    let lit: Table;
    let dist: Table;
    if (type === 1) ({ lit, dist } = fixed());
    else if (type === 2) {
      const hlit = bits(5) + 257;
      const hdist = bits(5) + 1;
      const hclen = bits(4) + 4;
      const codeLengths = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) codeLengths[CODE_LENGTH_ORDER[i]!] = bits(3);
      const codeTable = buildTable(codeLengths);
      const lengths = new Uint8Array(hlit + hdist);
      for (let i = 0; i < lengths.length; ) {
        const s = symbol(codeTable);
        if (s < 16) lengths[i++] = s;
        else {
          let repeat: number;
          let value = 0;
          if (s === 16) {
            if (i === 0) throw new Error('bad code lengths');
            value = lengths[i - 1]!;
            repeat = 3 + bits(2);
          } else if (s === 17) repeat = 3 + bits(3);
          else repeat = 11 + bits(7);
          if (i + repeat > lengths.length) throw new Error('bad code lengths');
          lengths.fill(value, i, i + repeat);
          i += repeat;
        }
      }
      lit = buildTable(lengths.subarray(0, hlit));
      dist = buildTable(lengths.subarray(hlit));
    } else throw new Error('bad block type');

    for (;;) {
      const s = symbol(lit);
      if (s < 256) {
        ensure(1);
        out[outLen++] = s;
      } else if (s === 256) break;
      else {
        const li = s - 257;
        if (li >= 29) throw new Error('bad length code');
        const length = LENGTH_BASE[li]! + bits(LENGTH_EXTRA[li]!);
        const di = symbol(dist);
        if (di >= 30) throw new Error('bad distance code');
        const distance = DIST_BASE[di]! + bits(DIST_EXTRA[di]!);
        if (distance > outLen) throw new Error('distance too far');
        ensure(length);
        for (let i = 0; i < length; i++, outLen++) out[outLen] = out[outLen - distance]!;
      }
    }
  }
  return out.subarray(0, outLen);
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; ) {
    const end = Math.min(i + 5552, data.length);
    for (; i < end; i++) {
      a += data[i]!;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

class BitWriter {
  private buf: Uint8Array;
  private len = 0;
  private acc = 0;
  private count = 0;
  constructor(size: number) {
    this.buf = new Uint8Array(Math.max(size, 64));
  }
  // Writes the low n bits of value, least significant first.
  write(value: number, n: number): void {
    this.acc |= value << this.count;
    this.count += n;
    while (this.count >= 8) {
      this.byte(this.acc & 0xff);
      this.acc >>>= 8;
      this.count -= 8;
    }
  }
  byte(b: number): void {
    if (this.len === this.buf.length) {
      const bigger = new Uint8Array(this.buf.length * 2);
      bigger.set(this.buf);
      this.buf = bigger;
    }
    this.buf[this.len++] = b;
  }
  flush(): void {
    if (this.count > 0) this.byte(this.acc & 0xff);
    this.acc = 0;
    this.count = 0;
  }
  result(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

// Fixed Huffman codes, already bit-reversed for the LSB-first writer.
let fixedCodes: { lit: Uint16Array; litLen: Uint8Array; lengthCode: Uint16Array; distCode: Uint8Array } | null = null;
function codes(): NonNullable<typeof fixedCodes> {
  if (fixedCodes) return fixedCodes;
  const lit = new Uint16Array(288);
  const litLen = new Uint8Array(288);
  for (let s = 0; s < 288; s++) {
    let code: number;
    let len: number;
    if (s < 144) [code, len] = [0x30 + s, 8];
    else if (s < 256) [code, len] = [0x190 + s - 144, 9];
    else if (s < 280) [code, len] = [s - 256, 7];
    else [code, len] = [0xc0 + s - 280, 8];
    lit[s] = reverseBits(code, len);
    litLen[s] = len;
  }
  // Index of the length code for every match length 3…258, and of the distance code for 1…32768.
  const lengthCode = new Uint16Array(259);
  for (let i = 0; i < 29; i++) {
    const end = i === 28 ? 259 : LENGTH_BASE[i + 1]!;
    for (let l = LENGTH_BASE[i]!; l < end; l++) lengthCode[l] = i;
  }
  lengthCode[258] = 28;
  const distCode = new Uint8Array(32769);
  for (let i = 0; i < 30; i++) {
    const end = i === 29 ? 32769 : DIST_BASE[i + 1]!;
    for (let d = DIST_BASE[i]!; d < end; d++) distCode[d] = i;
  }
  fixedCodes = { lit, litLen, lengthCode, distCode };
  return fixedCodes;
}

const WINDOW = 32768;
const HASH_BITS = 15;
const MAX_CHAIN = 24;

export function deflate(data: Uint8Array): Uint8Array {
  const { lit, litLen, lengthCode, distCode } = codes();
  const w = new BitWriter(data.length / 2 + 64);
  w.byte(0x78);
  w.byte(0x01);
  w.write(1, 1); // final block
  w.write(1, 2); // fixed Huffman

  const head = new Int32Array(1 << HASH_BITS).fill(-1);
  const prev = new Int32Array(WINDOW);
  const hash = (i: number): number => ((data[i]! << 10) ^ (data[i + 1]! << 5) ^ data[i + 2]!) & ((1 << HASH_BITS) - 1);
  const insert = (i: number): void => {
    if (i + 2 >= data.length) return;
    const h = hash(i);
    prev[i & (WINDOW - 1)] = head[h]!;
    head[h] = i;
  };

  let i = 0;
  while (i < data.length) {
    let bestLen = 0;
    let bestDist = 0;
    if (i + 2 < data.length) {
      let candidate = head[hash(i)]!;
      const max = Math.min(258, data.length - i);
      for (let chain = 0; candidate >= 0 && i - candidate <= WINDOW && chain < MAX_CHAIN; chain++) {
        if (data[candidate + bestLen] === data[i + bestLen]) {
          let len = 0;
          while (len < max && data[candidate + len] === data[i + len]) len++;
          if (len > bestLen) {
            bestLen = len;
            bestDist = i - candidate;
            if (len === max) break;
          }
        }
        const next = prev[candidate & (WINDOW - 1)]!;
        if (next >= candidate) break;
        candidate = next;
      }
    }
    if (bestLen >= 3) {
      const li = lengthCode[bestLen]!;
      w.write(lit[257 + li]!, litLen[257 + li]!);
      w.write(bestLen - LENGTH_BASE[li]!, LENGTH_EXTRA[li]!);
      const di = distCode[bestDist]!;
      w.write(reverseBits(di, 5), 5);
      w.write(bestDist - DIST_BASE[di]!, DIST_EXTRA[di]!);
      for (let k = 0; k < bestLen; k++) insert(i + k);
      i += bestLen;
    } else {
      w.write(lit[data[i]!]!, litLen[data[i]!]!);
      insert(i);
      i++;
    }
  }
  w.write(lit[256]!, litLen[256]!);
  w.flush();
  const sum = adler32(data);
  w.byte(sum >>> 24);
  w.byte((sum >>> 16) & 0xff);
  w.byte((sum >>> 8) & 0xff);
  w.byte(sum & 0xff);
  return w.result();
}
