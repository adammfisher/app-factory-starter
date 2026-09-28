// JPEG decode (baseline and progressive Huffman, any sampling, EXIF orientation applied) and
// encode (baseline, 4:2:0), in plain JavaScript.
import { orient, type Bitmap } from './bitmap';

// Zigzag position → natural (row-major) position in an 8 × 8 block.
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43,
  36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

// COS[x * 8 + u] = C(u) / 2 · cos((2x + 1)uπ / 16): the orthonormal 8-point DCT basis.
const COS = (() => {
  const table = new Float64Array(64);
  for (let x = 0; x < 8; x++) {
    for (let u = 0; u < 8; u++) table[x * 8 + u] = (u === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  }
  return table;
})();

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

// --- Decoder

type Huffman = { maxCode: Int32Array; valPtr: Int32Array; minCode: Int32Array; values: Uint8Array };

type Component = {
  id: number;
  h: number;
  v: number;
  tq: number;
  blocksPerLine: number; // blocks that hold image data
  blocksPerColumn: number;
  stride: number; // blocks per row in blockData, padded to whole MCUs
  rows: number;
  blockData: Int16Array;
  pred: number;
  dc?: Huffman;
  ac?: Huffman;
};

function buildHuffman(counts: Uint8Array, values: Uint8Array): Huffman {
  const maxCode = new Int32Array(18).fill(-1);
  const valPtr = new Int32Array(17);
  const minCode = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    const n = counts[len - 1]!;
    valPtr[len] = k;
    minCode[len] = code;
    code += n;
    k += n;
    maxCode[len] = n ? code - 1 : -1;
    code <<= 1;
  }
  maxCode[17] = 0x7fffffff;
  return { maxCode, valPtr, minCode, values };
}

function readExifOrientation(segment: Uint8Array): number {
  // segment starts after the APP1 length: "Exif\0\0" then a TIFF header.
  if (segment.length < 14 || String.fromCharCode(...segment.subarray(0, 4)) !== 'Exif') return 1;
  const tiff = 6;
  const little = segment[tiff] === 0x49;
  const u16 = (at: number): number => (little ? segment[at]! | (segment[at + 1]! << 8) : (segment[at]! << 8) | segment[at + 1]!);
  const u32 = (at: number): number => (little ? u16(at) + u16(at + 2) * 65536 : u16(at) * 65536 + u16(at + 2));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > segment.length) return 1;
  const entries = u16(ifd);
  for (let i = 0; i < entries; i++) {
    const at = ifd + 2 + i * 12;
    if (at + 12 > segment.length) break;
    if (u16(at) === 0x0112) {
      const value = u16(at + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

export function decodeJpeg(bytes: Uint8Array): Bitmap {
  if (!isJpeg(bytes)) throw new Error('not a JPEG');
  const quant: Int32Array[] = [];
  const dcTables: Huffman[] = [];
  const acTables: Huffman[] = [];
  let frame: { width: number; height: number; progressive: boolean; components: Component[]; maxH: number; maxV: number; mcusPerLine: number; mcusPerColumn: number } | null =
    null;
  let resetInterval = 0;
  let adobeTransform = -1;
  let orientation = 1;
  let offset = 2;

  const u16 = (at: number): number => (bytes[at]! << 8) | bytes[at + 1]!;

  for (;;) {
    if (offset + 1 >= bytes.length) break;
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1]!;
    offset += 2;
    if (marker === 0xff || marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      if (marker === 0xff) offset--;
      continue;
    }
    if (marker === 0xd9) break;
    const length = u16(offset);
    const segment = bytes.subarray(offset + 2, offset + length);
    if (segment.length < length - 2) throw new Error('truncated JPEG');

    if (marker === 0xe1) {
      if (orientation === 1) orientation = readExifOrientation(segment);
    } else if (marker === 0xee) {
      if (String.fromCharCode(...segment.subarray(0, 5)) === 'Adobe' && segment.length >= 12) adobeTransform = segment[11]!;
    } else if (marker === 0xdb) {
      for (let at = 0; at < segment.length; ) {
        const precision = segment[at]! >> 4;
        const id = segment[at]! & 15;
        at++;
        const table = new Int32Array(64);
        for (let k = 0; k < 64; k++) {
          table[ZIGZAG[k]!] = precision ? (segment[at]! << 8) | segment[at + 1]! : segment[at]!;
          at += precision ? 2 : 1;
        }
        quant[id] = table;
      }
    } else if (marker === 0xc4) {
      for (let at = 0; at < segment.length; ) {
        const cls = segment[at]! >> 4;
        const id = segment[at]! & 15;
        const counts = segment.subarray(at + 1, at + 17);
        const total = counts.reduce((n, c) => n + c, 0);
        const values = segment.slice(at + 17, at + 17 + total);
        (cls === 0 ? dcTables : acTables)[id] = buildHuffman(counts, values);
        at += 17 + total;
      }
    } else if (marker === 0xdd) {
      resetInterval = u16(offset + 2);
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (segment[0] !== 8) throw new Error('unsupported JPEG precision');
      const height = u16(offset + 3);
      const width = u16(offset + 5);
      if (width === 0 || height === 0) throw new Error('unsupported JPEG size');
      const count = segment[5]!;
      const components: Component[] = [];
      for (let i = 0; i < count; i++) {
        const at = 6 + i * 3;
        const h = Math.max(1, segment[at + 1]! >> 4);
        const v = Math.max(1, segment[at + 1]! & 15);
        components.push({ id: segment[at]!, h, v, tq: segment[at + 2]!, blocksPerLine: 0, blocksPerColumn: 0, stride: 0, rows: 0, blockData: new Int16Array(0), pred: 0 });
      }
      const maxH = Math.max(...components.map((c) => c.h));
      const maxV = Math.max(...components.map((c) => c.v));
      const mcusPerLine = Math.ceil(width / (8 * maxH));
      const mcusPerColumn = Math.ceil(height / (8 * maxV));
      for (const c of components) {
        c.blocksPerLine = Math.ceil(Math.ceil((width * c.h) / maxH) / 8);
        c.blocksPerColumn = Math.ceil(Math.ceil((height * c.v) / maxV) / 8);
        c.stride = mcusPerLine * c.h;
        c.rows = mcusPerColumn * c.v;
        c.blockData = new Int16Array(c.stride * c.rows * 64);
      }
      frame = { width, height, progressive: marker === 0xc2, components, maxH, maxV, mcusPerLine, mcusPerColumn };
    } else if (marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      throw new Error('unsupported JPEG coding');
    } else if (marker === 0xda) {
      if (!frame) throw new Error('JPEG scan before frame');
      const count = segment[0]!;
      const scanComponents: Component[] = [];
      for (let i = 0; i < count; i++) {
        const id = segment[1 + i * 2]!;
        const tables = segment[2 + i * 2]!;
        const c = frame.components.find((x) => x.id === id);
        if (!c) throw new Error('JPEG scan names an unknown component');
        c.dc = dcTables[tables >> 4];
        c.ac = acTables[tables & 15];
        scanComponents.push(c);
      }
      const at = 1 + count * 2;
      offset = decodeScan(bytes, offset + length, frame, scanComponents, resetInterval, segment[at]!, segment[at + 1]!, segment[at + 2]! >> 4, segment[at + 2]! & 15);
      continue;
    }
    offset += length;
  }
  if (!frame) throw new Error('JPEG has no frame');

  const { width, height, components, maxH, maxV } = frame;
  const planes = components.map((c) => {
    const table = quant[c.tq];
    if (!table) throw new Error('JPEG is missing a quantisation table');
    return { plane: componentPlane(c, table), lineWidth: c.stride * 8, sx: c.h / maxH, sy: c.v / maxV };
  });
  const data = new Uint8Array(width * height * 4);
  const rgbIds = components.length === 3 && components[0]!.id === 0x52 && components[1]!.id === 0x47 && components[2]!.id === 0x42;
  const ycc = components.length === 3 ? adobeTransform !== 0 && !rgbIds : adobeTransform === 2;
  const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  const values = new Float64Array(4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let i = 0; i < planes.length; i++) {
        const p = planes[i]!;
        values[i] = p.plane[Math.floor(y * p.sy) * p.lineWidth + Math.floor(x * p.sx)]!;
      }
      let r: number;
      let g: number;
      let b: number;
      if (planes.length === 1) r = g = b = values[0]!;
      else {
        const [c0, c1, c2] = [values[0]!, values[1]!, values[2]!];
        if (ycc) {
          r = c0 + 1.402 * (c2 - 128);
          g = c0 - 0.344136 * (c1 - 128) - 0.714136 * (c2 - 128);
          b = c0 + 1.772 * (c1 - 128);
        } else [r, g, b] = [c0, c1, c2];
        if (planes.length === 4) {
          // CMYK, or YCCK whose YCC part converts to the complement of CMY. Adobe writes CMYK
          // inverted; plain CMYK is not.
          const [c, m, y] = ycc ? [255 - clamp(r), 255 - clamp(g), 255 - clamp(b)] : [r, g, b];
          const k = values[3]!;
          if (adobeTransform >= 0) [r, g, b] = [(c * k) / 255, (m * k) / 255, (y * k) / 255];
          else [r, g, b] = [((255 - c) * (255 - k)) / 255, ((255 - m) * (255 - k)) / 255, ((255 - y) * (255 - k)) / 255];
        }
      }
      const o = (y * width + x) * 4;
      data[o] = clamp(r);
      data[o + 1] = clamp(g);
      data[o + 2] = clamp(b);
      data[o + 3] = 255;
    }
  }
  return orient({ width, height, data }, orientation);
}

// Dequantises and inverse-transforms every block of a component into 8-bit samples.
function componentPlane(c: Component, table: Int32Array): Uint8Array {
  const lineWidth = c.stride * 8;
  const plane = new Uint8Array(lineWidth * c.rows * 8);
  const coef = new Float64Array(64);
  const tmp = new Float64Array(64);
  for (let row = 0; row < c.rows; row++) {
    for (let col = 0; col < c.stride; col++) {
      const base = (row * c.stride + col) * 64;
      for (let i = 0; i < 64; i++) coef[i] = c.blockData[base + i]! * table[i]!;
      // Rows: tmp[v * 8 + x] = Σu coef[v * 8 + u] · COS[x * 8 + u]
      for (let v = 0; v < 8; v++) {
        for (let x = 0; x < 8; x++) {
          let s = 0;
          for (let u = 0; u < 8; u++) s += coef[v * 8 + u]! * COS[x * 8 + u]!;
          tmp[v * 8 + x] = s;
        }
      }
      for (let y = 0; y < 8; y++) {
        const line = (row * 8 + y) * lineWidth + col * 8;
        for (let x = 0; x < 8; x++) {
          let s = 0;
          for (let v = 0; v < 8; v++) s += tmp[v * 8 + x]! * COS[y * 8 + v]!;
          const value = Math.round(s + 128);
          plane[line + x] = value < 0 ? 0 : value > 255 ? 255 : value;
        }
      }
    }
  }
  return plane;
}

function decodeScan(
  data: Uint8Array,
  start: number,
  frame: { progressive: boolean; mcusPerLine: number; mcusPerColumn: number },
  components: Component[],
  resetInterval: number,
  spectralStart: number,
  spectralEnd: number,
  successivePrev: number,
  successive: number,
): number {
  let offset = start;
  let bitsData = 0;
  let bitsCount = 0;

  const readBit = (): number => {
    if (bitsCount > 0) {
      bitsCount--;
      return (bitsData >> bitsCount) & 1;
    }
    if (offset >= data.length) return 0;
    bitsData = data[offset]!;
    if (bitsData === 0xff) {
      const next = data[offset + 1];
      if (next === 0) offset += 2;
      else return 0; // a marker: pad with zeros and leave it for the caller
    } else offset++;
    bitsCount = 7;
    return (bitsData >> 7) & 1;
  };
  const receive = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | readBit();
    return v;
  };
  const receiveAndExtend = (n: number): number => {
    if (n === 1) return readBit() ? 1 : -1;
    const v = receive(n);
    return v >= 1 << (n - 1) ? v : v + (-1 << n) + 1;
  };
  const decodeHuffman = (table: Huffman | undefined): number => {
    if (!table) throw new Error('JPEG scan uses a missing Huffman table');
    let code = readBit();
    let len = 1;
    while (code > table.maxCode[len]!) {
      code = (code << 1) | readBit();
      len++;
      if (len > 16) throw new Error('bad JPEG Huffman code');
    }
    return table.values[table.valPtr[len]! + code - table.minCode[len]!]!;
  };

  let eobrun = 0;
  let acState = 0;
  let acNext = 0;

  const decodeBaseline = (c: Component, at: number): void => {
    const t = decodeHuffman(c.dc);
    c.pred += t === 0 ? 0 : receiveAndExtend(t);
    c.blockData[at] = c.pred;
    for (let k = 1; k < 64; ) {
      const rs = decodeHuffman(c.ac);
      const s = rs & 15;
      const r = rs >> 4;
      if (s === 0) {
        if (r < 15) break;
        k += 16;
        continue;
      }
      k += r;
      if (k > 63) break;
      c.blockData[at + ZIGZAG[k]!] = receiveAndExtend(s);
      k++;
    }
  };
  const decodeDcFirst = (c: Component, at: number): void => {
    const t = decodeHuffman(c.dc);
    c.pred += t === 0 ? 0 : receiveAndExtend(t) * (1 << successive);
    c.blockData[at] = c.pred;
  };
  const decodeDcSuccessive = (c: Component, at: number): void => {
    if (readBit()) c.blockData[at] = c.blockData[at]! | (1 << successive);
  };
  const decodeAcFirst = (c: Component, at: number): void => {
    if (eobrun > 0) {
      eobrun--;
      return;
    }
    for (let k = spectralStart; k <= spectralEnd; ) {
      const rs = decodeHuffman(c.ac);
      const s = rs & 15;
      const r = rs >> 4;
      if (s === 0) {
        if (r < 15) {
          eobrun = receive(r) + (1 << r) - 1;
          break;
        }
        k += 16;
        continue;
      }
      k += r;
      if (k > 63) break;
      c.blockData[at + ZIGZAG[k]!] = receiveAndExtend(s) * (1 << successive);
      k++;
    }
  };
  const decodeAcSuccessive = (c: Component, at: number): void => {
    let r = 0;
    for (let k = spectralStart; k <= spectralEnd; ) {
      const z = at + ZIGZAG[k]!;
      const current = c.blockData[z]!;
      const sign = current < 0 ? -1 : 1;
      if (acState === 0) {
        const rs = decodeHuffman(c.ac);
        const s = rs & 15;
        r = rs >> 4;
        if (s === 0) {
          if (r < 15) {
            eobrun = receive(r) + (1 << r);
            acState = 4;
          } else {
            r = 16;
            acState = 1;
          }
        } else {
          acNext = receiveAndExtend(s);
          acState = r ? 2 : 3;
        }
        continue;
      }
      if (acState === 1 || acState === 2) {
        if (current) c.blockData[z] = current + sign * (readBit() << successive);
        else {
          r--;
          if (r === 0) acState = acState === 2 ? 3 : 0;
        }
      } else if (acState === 3) {
        if (current) c.blockData[z] = current + sign * (readBit() << successive);
        else {
          c.blockData[z] = acNext << successive;
          acState = 0;
        }
      } else if (current) c.blockData[z] = current + sign * (readBit() << successive);
      k++;
    }
    if (acState === 4) {
      eobrun--;
      if (eobrun === 0) acState = 0;
    }
  };

  let decode: (c: Component, at: number) => void;
  if (!frame.progressive) decode = decodeBaseline;
  else if (spectralStart === 0) decode = successivePrev === 0 ? decodeDcFirst : decodeDcSuccessive;
  else decode = successivePrev === 0 ? decodeAcFirst : decodeAcSuccessive;

  const single = components.length === 1 ? components[0]! : null;
  const mcuExpected = single ? single.blocksPerLine * single.blocksPerColumn : frame.mcusPerLine * frame.mcusPerColumn;
  const decodeMcu = (n: number): void => {
    if (single) {
      const row = Math.floor(n / single.blocksPerLine);
      const col = n % single.blocksPerLine;
      decode(single, (row * single.stride + col) * 64);
      return;
    }
    const mcuRow = Math.floor(n / frame.mcusPerLine);
    const mcuCol = n % frame.mcusPerLine;
    for (const c of components) {
      for (let j = 0; j < c.v; j++) {
        for (let k = 0; k < c.h; k++) decode(c, ((mcuRow * c.v + j) * c.stride + mcuCol * c.h + k) * 64);
      }
    }
  };

  // The next marker at or after offset, skipping fill bytes; -1 at the end of the data.
  const findMarker = (): number => {
    while (offset + 1 < data.length) {
      if (data[offset] === 0xff && data[offset + 1] !== 0 && data[offset + 1] !== 0xff) return data[offset + 1]!;
      offset++;
    }
    return -1;
  };

  let mcu = 0;
  while (mcu < mcuExpected) {
    for (const c of components) c.pred = 0;
    eobrun = 0;
    acState = 0;
    const count = resetInterval ? Math.min(resetInterval, mcuExpected - mcu) : mcuExpected;
    for (let i = 0; i < count; i++, mcu++) decodeMcu(mcu);
    bitsCount = 0;
    const marker = findMarker();
    if (marker >= 0xd0 && marker <= 0xd7) offset += 2;
    else break;
  }
  findMarker();
  return offset;
}

// --- Encoder

const LUMA_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68,
  109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const CHROMA_QUANT = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];

// The example Huffman tables from the JPEG standard, Annex K.3.
const DC_LUMA_COUNTS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_CHROMA_COUNTS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_LUMA_COUNTS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUMA_VALUES = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23,
  0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a,
  0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64,
  0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
  0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2,
  0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8,
  0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];
const AC_CHROMA_COUNTS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHROMA_VALUES = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1,
  0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63,
  0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92,
  0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9,
  0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7,
  0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];

type Codes = { code: Uint16Array; size: Uint8Array };

function huffmanCodes(counts: number[], values: number[]): Codes {
  const code = new Uint16Array(256);
  const size = new Uint8Array(256);
  let next = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < counts[len - 1]!; i++) {
      code[values[k]!] = next++;
      size[values[k]!] = len;
      k++;
    }
    next <<= 1;
  }
  return { code, size };
}

// IJG quality scaling; quality is 0…1.
function scaledQuant(base: number[], quality: number): number[] {
  const q = Math.min(100, Math.max(1, Math.round(quality * 100)));
  const scale = q < 50 ? 5000 / q : 200 - q * 2;
  return base.map((v) => Math.min(255, Math.max(1, Math.floor((v * scale + 50) / 100))));
}

class ByteWriter {
  private buf: Uint8Array;
  length = 0;
  private acc = 0;
  private count = 0;
  constructor(size: number) {
    this.buf = new Uint8Array(Math.max(size, 1024));
  }
  byte(b: number): void {
    if (this.length === this.buf.length) {
      const bigger = new Uint8Array(this.buf.length * 2);
      bigger.set(this.buf);
      this.buf = bigger;
    }
    this.buf[this.length++] = b;
  }
  word(w: number): void {
    this.byte(w >> 8);
    this.byte(w & 0xff);
  }
  bytes(list: ArrayLike<number>): void {
    for (let i = 0; i < list.length; i++) this.byte(list[i]!);
  }
  // Entropy-coded bits, most significant first, with 0xFF stuffed.
  bits(value: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((value >> i) & 1);
      if (++this.count === 8) {
        this.byte(this.acc);
        if (this.acc === 0xff) this.byte(0);
        this.acc = 0;
        this.count = 0;
      }
    }
  }
  padBits(): void {
    if (this.count > 0) this.bits(0x7f, 8 - this.count);
  }
  result(): Uint8Array {
    return this.buf.subarray(0, this.length);
  }
}

// Writes a baseline JPEG. Alpha is dropped; callers flatten onto a background first.
export function encodeJpeg(bitmap: Bitmap, quality: number): Uint8Array {
  const { width, height, data } = bitmap;
  const lumaQ = scaledQuant(LUMA_QUANT, quality);
  const chromaQ = scaledQuant(CHROMA_QUANT, quality);
  const dcLuma = huffmanCodes(DC_LUMA_COUNTS, DC_VALUES);
  const dcChroma = huffmanCodes(DC_CHROMA_COUNTS, DC_VALUES);
  const acLuma = huffmanCodes(AC_LUMA_COUNTS, AC_LUMA_VALUES);
  const acChroma = huffmanCodes(AC_CHROMA_COUNTS, AC_CHROMA_VALUES);
  const out = new ByteWriter(width * height);

  out.word(0xffd8);
  out.word(0xffe0);
  out.word(16);
  out.bytes([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  out.word(0xffdb);
  out.word(2 + 65 * 2);
  for (const [id, table] of [[0, lumaQ], [1, chromaQ]] as const) {
    out.byte(id);
    for (let k = 0; k < 64; k++) out.byte(table[ZIGZAG[k]!]!);
  }
  out.word(0xffc0);
  out.word(17);
  out.byte(8);
  out.word(height);
  out.word(width);
  out.byte(3);
  out.bytes([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  out.word(0xffc4);
  out.word(2 + 4 * 17 + DC_VALUES.length * 2 + AC_LUMA_VALUES.length + AC_CHROMA_VALUES.length);
  for (const [id, counts, values] of [
    [0x00, DC_LUMA_COUNTS, DC_VALUES],
    [0x10, AC_LUMA_COUNTS, AC_LUMA_VALUES],
    [0x01, DC_CHROMA_COUNTS, DC_VALUES],
    [0x11, AC_CHROMA_COUNTS, AC_CHROMA_VALUES],
  ] as const) {
    out.byte(id);
    out.bytes(counts);
    out.bytes(values);
  }
  out.word(0xffda);
  out.word(12);
  out.bytes([3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);

  const block = new Float64Array(64);
  const tmp = new Float64Array(64);
  const coef = new Int32Array(64);
  const predictions = [0, 0, 0];

  const encodeBlock = (component: number, quant: number[], dc: Codes, ac: Codes): void => {
    // Rows then columns: F[v * 8 + u] = Σy Σx f[y * 8 + x] · COS[x * 8 + u] · COS[y * 8 + v]
    for (let y = 0; y < 8; y++) {
      for (let u = 0; u < 8; u++) {
        let s = 0;
        for (let x = 0; x < 8; x++) s += block[y * 8 + x]! * COS[x * 8 + u]!;
        tmp[y * 8 + u] = s;
      }
    }
    for (let v = 0; v < 8; v++) {
      for (let u = 0; u < 8; u++) {
        let s = 0;
        for (let y = 0; y < 8; y++) s += tmp[y * 8 + u]! * COS[y * 8 + v]!;
        coef[v * 8 + u] = Math.round(s / quant[v * 8 + u]!);
      }
    }
    const writeValue = (value: number, codes: Codes, symbolHigh: number): void => {
      const magnitude = Math.abs(value);
      let bits = 0;
      while (magnitude >> bits) bits++;
      const symbol = symbolHigh | bits;
      out.bits(codes.code[symbol]!, codes.size[symbol]!);
      if (bits) out.bits(value < 0 ? value - 1 + (1 << bits) : value, bits);
    };
    const diff = coef[0]! - predictions[component]!;
    predictions[component] = coef[0]!;
    writeValue(diff, dc, 0);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const value = coef[ZIGZAG[k]!]!;
      if (value === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        out.bits(ac.code[0xf0]!, ac.size[0xf0]!);
        run -= 16;
      }
      writeValue(value, ac, run << 4);
      run = 0;
    }
    if (run > 0) out.bits(ac.code[0]!, ac.size[0]!);
  };

  const at = (x: number, y: number): number => (Math.min(y, height - 1) * width + Math.min(x, width - 1)) * 4;
  const luma = (o: number): number => 0.299 * data[o]! + 0.587 * data[o + 1]! + 0.114 * data[o + 2]!;
  const cb = (o: number): number => -0.168736 * data[o]! - 0.331264 * data[o + 1]! + 0.5 * data[o + 2]! + 128;
  const cr = (o: number): number => 0.5 * data[o]! - 0.418688 * data[o + 1]! - 0.081312 * data[o + 2]! + 128;

  for (let my = 0; my < height; my += 16) {
    for (let mx = 0; mx < width; mx += 16) {
      for (let by = 0; by < 16; by += 8) {
        for (let bx = 0; bx < 16; bx += 8) {
          for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) block[y * 8 + x] = luma(at(mx + bx + x, my + by + y)) - 128;
          encodeBlock(0, lumaQ, dcLuma, acLuma);
        }
      }
      for (const [component, channel] of [[1, cb], [2, cr]] as const) {
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const sx = mx + x * 2;
            const sy = my + y * 2;
            block[y * 8 + x] = (channel(at(sx, sy)) + channel(at(sx + 1, sy)) + channel(at(sx, sy + 1)) + channel(at(sx + 1, sy + 1))) / 4 - 128;
          }
        }
        encodeBlock(component, chromaQ, dcChroma, acChroma);
      }
    }
  }
  out.padBits();
  out.word(0xffd9);
  return out.result();
}
