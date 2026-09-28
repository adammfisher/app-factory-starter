// SHA-256, SHA-384, SHA-512 and AES (128 and 256, CBC and ECB) in plain JavaScript: what the PDF
// standard security handler, revision 6, needs. Round constants and the S-box are computed when
// first used rather than typed out, so a typo cannot break them.

// --- Constants: fractional parts of square and cube roots of the first primes.

function primes(count: number): number[] {
  const out: number[] = [];
  for (let n = 2; out.length < count; n++) if (out.every((p) => n % p !== 0)) out.push(n);
  return out;
}

function integerRoot(n: bigint, k: number): bigint {
  const big = BigInt(k);
  const one = BigInt(1);
  if (n < BigInt(2)) return n;
  let x = one << BigInt(Math.ceil(n.toString(2).length / k) + 1);
  for (;;) {
    const y = ((big - one) * x + n / x ** (big - one)) / big;
    if (y >= x) return x;
    x = y;
  }
}

// The first `bits` bits of the fractional part of the k-th root of p.
function rootBits(p: number, k: number, bits: number): bigint {
  const shift = BigInt(bits * k);
  return integerRoot(BigInt(p) << shift, k) & ((BigInt(1) << BigInt(bits)) - BigInt(1));
}

type Sha2Constants = { k32: Uint32Array; h256: Uint32Array; k64: Uint32Array; h512: Uint32Array; h384: Uint32Array };
let sha2: Sha2Constants | null = null;
function constants(): Sha2Constants {
  if (sha2) return sha2;
  const p = primes(80);
  const pairs = (values: bigint[]): Uint32Array => {
    const out = new Uint32Array(values.length * 2);
    values.forEach((v, i) => {
      out[2 * i] = Number(v >> BigInt(32));
      out[2 * i + 1] = Number(v & BigInt(0xffffffff));
    });
    return out;
  };
  sha2 = {
    k32: Uint32Array.from(p.slice(0, 64), (q) => Number(rootBits(q, 3, 32))),
    h256: Uint32Array.from(p.slice(0, 8), (q) => Number(rootBits(q, 2, 32))),
    k64: pairs(p.map((q) => rootBits(q, 3, 64))),
    h512: pairs(p.slice(0, 8).map((q) => rootBits(q, 2, 64))),
    h384: pairs(p.slice(8, 16).map((q) => rootBits(q, 2, 64))),
  };
  return sha2;
}

// Appends the 0x80 marker, zeros and the bit length, to a whole number of blocks.
function pad(data: Uint8Array, blockSize: number, lengthBytes: number): Uint8Array {
  const total = Math.ceil((data.length + 1 + lengthBytes) / blockSize) * blockSize;
  const out = new Uint8Array(total);
  out.set(data);
  out[data.length] = 0x80;
  const bits = data.length * 8;
  const view = new DataView(out.buffer);
  view.setUint32(total - 8, Math.floor(bits / 0x100000000));
  view.setUint32(total - 4, bits >>> 0);
  return out;
}

export function sha256(data: Uint8Array): Uint8Array {
  const { k32, h256 } = constants();
  const h = Uint32Array.from(h256);
  const w = new Uint32Array(64);
  const msg = pad(data, 64, 8);
  const view = new DataView(msg.buffer);
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let block = 0; block < msg.length; block += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(block + t * 4);
    for (let t = 16; t < 64; t++) {
      const a = w[t - 15]!;
      const b = w[t - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as [number, number, number, number, number, number, number, number];
    for (let t = 0; t < 64; t++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + k32[t]! + w[t]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => (h[i] = (h[i]! + v) >>> 0));
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  h.forEach((v, i) => outView.setUint32(i * 4, v));
  return out;
}

// SHA-512 on pairs of 32-bit words (high, low); outputBytes 48 gives SHA-384.
function sha512Family(data: Uint8Array, initial: Uint32Array, outputBytes: number): Uint8Array {
  const { k64 } = constants();
  const h = Uint32Array.from(initial);
  const wh = new Uint32Array(80);
  const wl = new Uint32Array(80);
  const msg = pad(data, 128, 16);
  const view = new DataView(msg.buffer);
  const P = 0x100000000;
  // The rotations are written out: a function call per rotation costs ten times as much.
  // Writing a sum to a Uint32Array keeps its low 32 bits; the high word adds the carry.
  for (let block = 0; block < msg.length; block += 128) {
    for (let t = 0; t < 16; t++) {
      wh[t] = view.getUint32(block + t * 8);
      wl[t] = view.getUint32(block + t * 8 + 4);
    }
    for (let t = 16; t < 80; t++) {
      let xh = wh[t - 15]!;
      let xl = wl[t - 15]!;
      // σ0: rotate 1, rotate 8, shift 7.
      const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
      const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
      xh = wh[t - 2]!;
      xl = wl[t - 2]!;
      // σ1: rotate 19, rotate 61, shift 6.
      const s1h = ((xh >>> 19) | (xl << 13)) ^ ((xl >>> 29) | (xh << 3)) ^ (xh >>> 6);
      const s1l = ((xl >>> 19) | (xh << 13)) ^ ((xh >>> 29) | (xl << 3)) ^ ((xl >>> 6) | (xh << 26));
      const lo = (s0l >>> 0) + (s1l >>> 0) + wl[t - 7]! + wl[t - 16]!;
      wl[t] = lo;
      wh[t] = (s0h >>> 0) + (s1h >>> 0) + wh[t - 7]! + wh[t - 16]! + Math.floor(lo / P);
    }
    let [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl] = h as unknown as number[] as [
      number, number, number, number, number, number, number, number,
      number, number, number, number, number, number, number, number,
    ];
    for (let t = 0; t < 80; t++) {
      // Σ1(e): rotate 14, 18, 41. Σ0(a): rotate 28, 34, 39.
      const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
      const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
      const chooseH = (eh & fh) ^ (~eh & gh);
      const chooseL = (el & fl) ^ (~el & gl);
      const t1l = hl + (S1l >>> 0) + (chooseL >>> 0) + k64[2 * t + 1]! + wl[t]!;
      const t1h = hh + (S1h >>> 0) + (chooseH >>> 0) + k64[2 * t]! + wh[t]! + Math.floor(t1l / P);
      const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
      const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
      const majorityH = (ah & bh) ^ (ah & ch) ^ (bh & ch);
      const majorityL = (al & bl) ^ (al & cl) ^ (bl & cl);
      const t2l = (S0l >>> 0) + (majorityL >>> 0);
      const t2h = (S0h >>> 0) + (majorityH >>> 0) + Math.floor(t2l / P);
      hh = gh;
      hl = gl;
      gh = fh;
      gl = fl;
      fh = eh;
      fl = el;
      const newE = dl + (t1l >>> 0);
      eh = (dh + t1h + Math.floor(newE / P)) >>> 0;
      el = newE >>> 0;
      dh = ch;
      dl = cl;
      ch = bh;
      cl = bl;
      bh = ah;
      bl = al;
      const newA = (t1l >>> 0) + (t2l >>> 0);
      ah = (t1h + t2h + Math.floor(newA / P)) >>> 0;
      al = newA >>> 0;
    }
    const state = [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl];
    for (let i = 0; i < 16; i += 2) {
      const lo = h[i + 1]! + state[i + 1]!;
      h[i] = h[i]! + state[i]! + Math.floor(lo / P);
      h[i + 1] = lo;
    }
  }
  const out = new Uint8Array(64);
  const outView = new DataView(out.buffer);
  h.forEach((v, i) => outView.setUint32(i * 4, v));
  return out.slice(0, outputBytes);
}

export function sha512(data: Uint8Array): Uint8Array {
  return sha512Family(data, constants().h512, 64);
}

export function sha384(data: Uint8Array): Uint8Array {
  return sha512Family(data, constants().h384, 48);
}

// --- AES.

type AesTables = { sbox: Uint8Array; inv: Uint8Array; mul: Uint8Array[] };
let aes: AesTables | null = null;
function tables(): AesTables {
  if (aes) return aes;
  const gmul = (a: number, b: number): number => {
    let out = 0;
    for (let i = 0; i < 8; i++) {
      if (b & 1) out ^= a;
      a = ((a << 1) ^ (a & 0x80 ? 0x11b : 0)) & 0xff;
      b >>= 1;
    }
    return out;
  };
  const sbox = new Uint8Array(256);
  const inv = new Uint8Array(256);
  const rotl = (x: number, n: number): number => ((x << n) | (x >> (8 - n))) & 0xff;
  for (let x = 0; x < 256; x++) {
    let reciprocal = 0;
    if (x) for (reciprocal = 1; gmul(x, reciprocal) !== 1; reciprocal++);
    const y = reciprocal ^ rotl(reciprocal, 1) ^ rotl(reciprocal, 2) ^ rotl(reciprocal, 3) ^ rotl(reciprocal, 4) ^ 0x63;
    sbox[x] = y;
    inv[y] = x;
  }
  // mul[n][x] = n·x in GF(2^8), for the factors MixColumns and its inverse use.
  const mul: Uint8Array[] = [];
  for (const n of [2, 3, 9, 11, 13, 14]) mul[n] = Uint8Array.from({ length: 256 }, (_, x) => gmul(x, n));
  aes = { sbox, inv, mul };
  return aes;
}

// The expanded key: 16 bytes per round key.
function expandKey(key: Uint8Array): Uint8Array {
  if (key.length !== 16 && key.length !== 32) throw new Error('AES key must be 16 or 32 bytes');
  const { sbox } = tables();
  const nk = key.length / 4;
  const rounds = nk + 6;
  const out = new Uint8Array(16 * (rounds + 1));
  out.set(key);
  let rcon = 1;
  for (let i = nk; i < 4 * (rounds + 1); i++) {
    const t = out.slice(4 * (i - 1), 4 * i);
    if (i % nk === 0) {
      const first = t[0]!;
      t[0] = sbox[t[1]!]! ^ rcon;
      t[1] = sbox[t[2]!]!;
      t[2] = sbox[t[3]!]!;
      t[3] = sbox[first]!;
      rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x11b : 0)) & 0xff;
    } else if (nk > 6 && i % nk === 4) {
      for (let j = 0; j < 4; j++) t[j] = sbox[t[j]!]!;
    }
    for (let j = 0; j < 4; j++) out[4 * i + j] = out[4 * (i - nk) + j]! ^ t[j]!;
  }
  return out;
}

// Encryption on 32-bit columns (row 0 in the high byte) with the usual combined tables: te[k][x]
// is SubBytes and MixColumns for byte x in row k, so a round is 16 lookups. Encryption carries
// the password hash loop and every stream of a new file, so it is the part worth making fast.
type Encryptor = { te: Uint32Array[]; sbox: Uint8Array; keys: Uint32Array; rounds: number };
let te: Uint32Array[] | null = null;
function encryptor(key: Uint8Array): Encryptor {
  const { sbox, mul } = tables();
  if (!te) {
    const t0 = Uint32Array.from(sbox, (s) => ((mul[2]![s]! << 24) | (s << 16) | (s << 8) | mul[3]![s]!) >>> 0);
    const rot = (t: Uint32Array): Uint32Array => t.map((v) => ((v >>> 8) | (v << 24)) >>> 0);
    const t1 = rot(t0);
    const t2 = rot(t1);
    te = [t0, t1, t2, rot(t2)];
  }
  const bytes = expandKey(key);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keys = Uint32Array.from({ length: bytes.length / 4 }, (_, i) => view.getUint32(i * 4));
  return { te, sbox, keys, rounds: bytes.length / 16 - 1 };
}

// Encrypts the block at `at` in place.
function encryptBlock(e: Encryptor, b: Uint8Array, at: number): void {
  const [t0, t1, t2, t3] = e.te as [Uint32Array, Uint32Array, Uint32Array, Uint32Array];
  const { keys, sbox, rounds } = e;
  const word = (i: number): number => ((b[at + i]! << 24) | (b[at + i + 1]! << 16) | (b[at + i + 2]! << 8) | b[at + i + 3]!) >>> 0;
  let s0 = word(0) ^ keys[0]!;
  let s1 = word(4) ^ keys[1]!;
  let s2 = word(8) ^ keys[2]!;
  let s3 = word(12) ^ keys[3]!;
  for (let r = 1; r < rounds; r++) {
    const k = 4 * r;
    const n0 = t0[s0 >>> 24]! ^ t1[(s1 >>> 16) & 255]! ^ t2[(s2 >>> 8) & 255]! ^ t3[s3 & 255]! ^ keys[k]!;
    const n1 = t0[s1 >>> 24]! ^ t1[(s2 >>> 16) & 255]! ^ t2[(s3 >>> 8) & 255]! ^ t3[s0 & 255]! ^ keys[k + 1]!;
    const n2 = t0[s2 >>> 24]! ^ t1[(s3 >>> 16) & 255]! ^ t2[(s0 >>> 8) & 255]! ^ t3[s1 & 255]! ^ keys[k + 2]!;
    const n3 = t0[s3 >>> 24]! ^ t1[(s0 >>> 16) & 255]! ^ t2[(s1 >>> 8) & 255]! ^ t3[s2 & 255]! ^ keys[k + 3]!;
    s0 = n0 >>> 0;
    s1 = n1 >>> 0;
    s2 = n2 >>> 0;
    s3 = n3 >>> 0;
  }
  const k = 4 * rounds;
  const last = (a: number, bb: number, c: number, d: number, key: number): number =>
    ((sbox[a >>> 24]! << 24) | (sbox[(bb >>> 16) & 255]! << 16) | (sbox[(c >>> 8) & 255]! << 8) | sbox[d & 255]!) ^ key;
  const out = [last(s0, s1, s2, s3, keys[k]!), last(s1, s2, s3, s0, keys[k + 1]!), last(s2, s3, s0, s1, keys[k + 2]!), last(s3, s0, s1, s2, keys[k + 3]!)];
  for (let i = 0; i < 4; i++) {
    const v = out[i]!;
    b[at + 4 * i] = v >>> 24;
    b[at + 4 * i + 1] = (v >>> 16) & 255;
    b[at + 4 * i + 2] = (v >>> 8) & 255;
    b[at + 4 * i + 3] = v & 255;
  }
}

function decryptBlock(keys: Uint8Array, s: Uint8Array): void {
  const { inv, mul } = tables();
  const [m9, m11, m13, m14] = [mul[9]!, mul[11]!, mul[13]!, mul[14]!];
  const rounds = keys.length / 16 - 1;
  const t = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i]! ^= keys[16 * rounds + i]!;
  for (let round = rounds - 1; round >= 0; round--) {
    // InvShiftRows and InvSubBytes: byte (row r, column c) comes from column c - r.
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[4 * c + r] = inv[s[4 * ((c - r + 4) % 4) + r]!]!;
    for (let i = 0; i < 16; i++) t[i]! ^= keys[16 * round + i]!;
    if (round > 0) {
      for (let c = 0; c < 16; c += 4) {
        const [a0, a1, a2, a3] = [t[c]!, t[c + 1]!, t[c + 2]!, t[c + 3]!];
        s[c] = m14[a0]! ^ m11[a1]! ^ m13[a2]! ^ m9[a3]!;
        s[c + 1] = m9[a0]! ^ m14[a1]! ^ m11[a2]! ^ m13[a3]!;
        s[c + 2] = m13[a0]! ^ m9[a1]! ^ m14[a2]! ^ m11[a3]!;
        s[c + 3] = m11[a0]! ^ m13[a1]! ^ m9[a2]! ^ m14[a3]!;
      }
    } else s.set(t);
  }
}

// CBC encryption. With padding, PKCS#5 padding is added; without, data must be whole blocks.
export function aesCbcEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array, padding: boolean): Uint8Array {
  const e = encryptor(key);
  const extra = padding ? 16 - (data.length % 16) : 0;
  if (!padding && data.length % 16) throw new Error('AES data must be whole blocks');
  const out = new Uint8Array(data.length + extra);
  out.set(data);
  out.fill(extra, data.length);
  for (let i = 0; i < 16; i++) out[i]! ^= iv[i]!;
  for (let at = 0; at < out.length; at += 16) {
    if (at > 0) for (let i = 0; i < 16; i++) out[at + i]! ^= out[at - 16 + i]!;
    encryptBlock(e, out, at);
  }
  return out;
}

// CBC decryption; with padding, removes and checks PKCS#5 padding (throws when it is wrong).
export function aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array, padding: boolean): Uint8Array {
  if (data.length % 16) throw new Error('AES data must be whole blocks');
  const keys = expandKey(key);
  const out = new Uint8Array(data.length);
  const block = new Uint8Array(16);
  for (let at = 0; at < data.length; at += 16) {
    block.set(data.subarray(at, at + 16));
    decryptBlock(keys, block);
    const previous = at === 0 ? iv : data.subarray(at - 16, at);
    for (let i = 0; i < 16; i++) out[at + i] = block[i]! ^ previous[i]!;
  }
  if (!padding) return out;
  const extra = out[out.length - 1] ?? 0;
  if (extra < 1 || extra > 16 || extra > out.length) throw new Error('bad AES padding');
  return out.subarray(0, out.length - extra);
}

export function aesEcbEncrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  const e = encryptor(key);
  const out = Uint8Array.from(data);
  for (let at = 0; at < out.length; at += 16) encryptBlock(e, out, at);
  return out;
}

export function aesEcbDecrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  const keys = expandKey(key);
  const out = Uint8Array.from(data);
  for (let at = 0; at < out.length; at += 16) decryptBlock(keys, out.subarray(at, at + 16));
  return out;
}

// --- Random bytes: the platform's secure generator when there is one. Callers that need secrecy
// (the file key) also mix in the password, so a missing generator never makes a key guessable
// without it.

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const source = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (source?.getRandomValues) source.getRandomValues(out);
  else for (let i = 0; i < length; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
