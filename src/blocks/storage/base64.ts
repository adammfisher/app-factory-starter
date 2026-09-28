// Base64 without Buffer, btoa or atob, which not every engine the app runs on has.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VALID = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const n = (a << 16) | (b << 8) | c;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? ALPHABET[n & 63]! : '=';
  }
  return out;
}

// The bytes the text encodes, or null when it is not base64.
export function fromBase64(text: string): Uint8Array | null {
  if (!VALID.test(text)) return null;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let at = 0;
  for (let i = 0; i < text.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const ch = text[i + j]!;
      n = (n << 6) | (ch === '=' ? 0 : ALPHABET.indexOf(ch));
    }
    if (at < out.length) out[at++] = (n >> 16) & 0xff;
    if (at < out.length) out[at++] = (n >> 8) & 0xff;
    if (at < out.length) out[at++] = n & 0xff;
  }
  return out;
}
