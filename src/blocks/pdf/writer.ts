// Writes a PDF: one page per image, the image scaled to fit the page, and an optional invisible
// text layer (text render mode 3) that viewers can search, select and copy. The text uses a
// Type0 font with Identity-H encoding and a ToUnicode map, so any Unicode text survives. With a
// password the file is encrypted with the standard security handler, revision 6.
import type { PdfImage } from './images';
import { dict, latin1Bytes, name, ref, serialize, serializeObject, text, type Crypt, type PdfDict, type PdfValue } from './objects';
import { createEncryption, encryptData } from './security';
import { concat, randomBytes, sha256 } from './crypto';
import { deflate } from './zlib';

export type PageSize = 'letter' | 'a4' | 'auto';
export type PdfPageInput = { image: PdfImage; text?: string };

// Page sizes in points (1/72 inch).
const SIZES: Record<Exclude<PageSize, 'auto'>, [number, number]> = { letter: [612, 792], a4: [595.28, 841.89] };
// An "auto" page has its image's aspect ratio, with its longer side as long as a letter page.
const AUTO_LONG_SIDE = 792;
const FONT_SIZE = 12;
const LEADING = 14;

function pageBox(image: PdfImage, size: PageSize): { width: number; height: number; x: number; y: number; w: number; h: number } {
  if (size === 'auto') {
    const scale = AUTO_LONG_SIDE / Math.max(image.width, image.height);
    const [width, height] = [image.width * scale, image.height * scale];
    return { width, height, x: 0, y: 0, w: width, h: height };
  }
  const [width, height] = SIZES[size];
  const scale = Math.min(width / image.width, height / image.height);
  const [w, h] = [image.width * scale, image.height * scale];
  return { width, height, x: (width - w) / 2, y: (height - h) / 2, w, h };
}

const round = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));

// Each UTF-16 code unit is one 2-byte code; the ToUnicode map sends every code to itself.
function utf16Hex(line: string): string {
  let out = '';
  for (let i = 0; i < line.length; i++) out += line.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${out}>`;
}

function toUnicodeCMap(): Uint8Array {
  const ranges: string[] = [];
  for (let hi = 0; hi < 256; hi++) {
    const h = hi.toString(16).padStart(2, '0').toUpperCase();
    ranges.push(`<${h}00> <${h}FF> <${h}00>`);
  }
  const blocks: string[] = [];
  for (let i = 0; i < ranges.length; i += 100) {
    const part = ranges.slice(i, i + 100);
    blocks.push(`${part.length} beginbfrange\n${part.join('\n')}\nendbfrange`);
  }
  return latin1Bytes(
    [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def',
      '/CMapType 2 def',
      '1 begincodespacerange',
      '<0000> <FFFF>',
      'endcodespacerange',
      ...blocks,
      'endcmap',
      'CMapName currentdict /CMap defineresource pop',
      'end',
      'end',
    ].join('\n'),
  );
}

function contentStream(box: ReturnType<typeof pageBox>, pageText: string | undefined): Uint8Array {
  const ops = [`q ${round(box.w)} 0 0 ${round(box.h)} ${round(box.x)} ${round(box.y)} cm /Im1 Do Q`];
  if (pageText) {
    const lines = pageText.split(/\r\n|\r|\n/);
    ops.push('BT', `/F1 ${FONT_SIZE} Tf`, '3 Tr', `${LEADING} TL`, `${round(box.x)} ${round(box.y + box.h - FONT_SIZE)} Td`);
    lines.forEach((line, i) => {
      if (i > 0) ops.push('T*');
      if (line) ops.push(`${utf16Hex(line)} Tj`);
    });
    ops.push('ET');
  }
  return deflate(latin1Bytes(ops.join('\n')));
}

function imageObject(image: PdfImage, smask: number | undefined): { dict: PdfDict; data: Uint8Array } {
  const channels = image.colorSpace === 'DeviceGray' ? 1 : image.colorSpace === 'DeviceRGB' ? 3 : 4;
  return {
    dict: dict({
      Type: name('XObject'),
      Subtype: name('Image'),
      Width: image.width,
      Height: image.height,
      ColorSpace: name(image.colorSpace),
      BitsPerComponent: image.bitsPerComponent,
      Filter: name(image.filter),
      DecodeParms: image.predictor
        ? dict({ Predictor: 15, Colors: image.predictor.colors, BitsPerComponent: 8, Columns: image.predictor.columns })
        : undefined,
      Decode: image.invert ? Array.from({ length: channels }, () => [1, 0]).flat() : undefined,
      SMask: smask === undefined ? undefined : ref(smask),
    }),
    data: image.data,
  };
}

export function buildPdf(pages: PdfPageInput[], size: PageSize, password?: string): Uint8Array {
  const objects: PdfValue[] = [];
  const add = (value: PdfValue): number => objects.push(value);
  const encryption = password ? createEncryption(password) : null;

  const catalog = add(null);
  const pageTree = add(null);
  let font: number | undefined;
  if (pages.some((p) => p.text)) {
    const toUnicode = add({ dict: dict({ Filter: name('FlateDecode') }), data: deflate(toUnicodeCMap()) });
    const descriptor = add(
      dict({
        Type: name('FontDescriptor'),
        FontName: name('Helvetica'),
        Flags: 32,
        FontBBox: [-166, -225, 1000, 931],
        ItalicAngle: 0,
        Ascent: 718,
        Descent: -207,
        CapHeight: 718,
        StemV: 88,
      }),
    );
    const cidFont = add(
      dict({
        Type: name('Font'),
        Subtype: name('CIDFontType2'),
        BaseFont: name('Helvetica'),
        CIDSystemInfo: dict({ Registry: text('Adobe'), Ordering: text('Identity'), Supplement: 0 }),
        FontDescriptor: ref(descriptor),
        DW: 500,
        CIDToGIDMap: name('Identity'),
      }),
    );
    font = add(
      dict({
        Type: name('Font'),
        Subtype: name('Type0'),
        BaseFont: name('Helvetica'),
        Encoding: name('Identity-H'),
        DescendantFonts: [ref(cidFont)],
        ToUnicode: ref(toUnicode),
      }),
    );
  }

  const kids: PdfValue[] = [];
  for (const page of pages) {
    const box = pageBox(page.image, size);
    const smask =
      page.image.alpha === undefined
        ? undefined
        : add({
            dict: dict({
              Type: name('XObject'),
              Subtype: name('Image'),
              Width: page.image.width,
              Height: page.image.height,
              ColorSpace: name('DeviceGray'),
              BitsPerComponent: 8,
              Filter: name('FlateDecode'),
            }),
            data: page.image.alpha,
          });
    const image = add(imageObject(page.image, smask));
    const content = add({ dict: dict({ Filter: name('FlateDecode') }), data: contentStream(box, page.text) });
    kids.push(
      ref(
        add(
          dict({
            Type: name('Page'),
            Parent: ref(pageTree),
            MediaBox: [0, 0, box.width, box.height],
            Resources: dict({
              XObject: dict({ Im1: ref(image) }),
              Font: page.text && font !== undefined ? dict({ F1: ref(font) }) : undefined,
            }),
            Contents: ref(content),
          }),
        ),
      ),
    );
  }
  objects[pageTree - 1] = dict({ Type: name('Pages'), Kids: kids, Count: kids.length });
  objects[catalog - 1] = dict({
    Type: name('Catalog'),
    Pages: ref(pageTree),
    // Revision 6 encryption is PDF 2.0; Acrobat reads it in 1.7 files as extension level 8.
    Extensions: encryption ? dict({ ADBE: dict({ BaseVersion: name('1.7'), ExtensionLevel: 8 }) }) : undefined,
  });

  let encryptRef: number | undefined;
  if (encryption) {
    const { O, U, OE, UE, Perms, P } = encryption.values;
    encryptRef = add(
      dict({
        Filter: name('Standard'),
        V: 5,
        R: 6,
        Length: 256,
        CF: dict({ StdCF: dict({ AuthEvent: name('DocOpen'), CFM: name('AESV3'), Length: 32 }) }),
        StmF: name('StdCF'),
        StrF: name('StdCF'),
        O: { bytes: O },
        U: { bytes: U },
        OE: { bytes: OE },
        UE: { bytes: UE },
        P,
        Perms: { bytes: Perms },
        EncryptMetadata: true,
      }),
    );
  }
  const crypt: Crypt | undefined = encryption ? (data) => encryptData(encryption.fileKey, data) : undefined;

  const chunks: Uint8Array[] = [latin1Bytes('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')];
  let offset = chunks[0]!.length;
  const offsets: number[] = [];
  objects.forEach((value, i) => {
    offsets.push(offset);
    const bytes = serializeObject(i + 1, value, i + 1 === encryptRef ? undefined : crypt);
    chunks.push(bytes);
    offset += bytes.length;
  });

  const id = { bytes: sha256(concat(randomBytes(16), latin1Bytes(String(Date.now())))).subarray(0, 16) };
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `),
    'trailer',
  ].join('\n');
  // The trailer and its file ID are never encrypted.
  const trailer = serialize(
    dict({ Size: objects.length + 1, Root: ref(catalog), Encrypt: encryptRef === undefined ? undefined : ref(encryptRef), ID: [id, id] }),
  );
  chunks.push(latin1Bytes(`${xref}\n${trailer}\nstartxref\n${offset}\n%%EOF\n`));
  return concat(...chunks);
}
