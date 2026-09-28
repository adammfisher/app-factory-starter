// The PDF standard security handler, revision 6 (ISO 32000-2, 7.6.4): AES-256 for every string
// and stream, keyed by a random file key that only the password can unwrap. The password is both
// the user and the owner password, and every permission is granted.
import { aesCbcDecrypt, aesCbcEncrypt, aesEcbDecrypt, aesEcbEncrypt, concat, equalBytes, randomBytes, sha256, sha384, sha512 } from './crypto';

export type EncryptValues = { O: Uint8Array; U: Uint8Array; OE: Uint8Array; UE: Uint8Array; Perms: Uint8Array; P: number };

// Every permission (bits 3–12 set, the reserved high bits set, bits 1–2 clear).
export const ALL_PERMISSIONS = -4;

const ZERO_IV = new Uint8Array(16);

// The password as UTF-8, at most 127 bytes.
export function passwordBytes(password: string): Uint8Array {
  const utf8 = new TextEncoder().encode(password.normalize('NFKC'));
  return utf8.subarray(0, 127);
}

// Algorithm 2.B: the revision 6 password hash.
export function hash(password: Uint8Array, salt: Uint8Array, userKey: Uint8Array): Uint8Array {
  let k = sha256(concat(password, salt, userKey));
  let e: Uint8Array = new Uint8Array(0);
  for (let round = 0; round < 64 || e[e.length - 1]! > round - 32; round++) {
    const one = concat(password, k, userKey);
    const k1 = new Uint8Array(one.length * 64);
    for (let i = 0; i < 64; i++) k1.set(one, i * one.length);
    e = aesCbcEncrypt(k.subarray(0, 16), k.subarray(16, 32), k1, false);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i]!;
    const which = sum % 3;
    k = which === 0 ? sha256(e) : which === 1 ? sha384(e) : sha512(e);
  }
  return k.subarray(0, 32);
}

// Makes the /Encrypt values and the file key for a new file.
export function createEncryption(password: string): { fileKey: Uint8Array; values: EncryptValues } {
  const pw = passwordBytes(password);
  // The key mixes the password into the random bytes, so it stays secret even where the
  // platform has no secure random generator.
  const fileKey = sha256(concat(randomBytes(32), pw, new TextEncoder().encode(String(Date.now()))));
  const [userValidation, userKeySalt, ownerValidation, ownerKeySalt] = [randomBytes(8), randomBytes(8), randomBytes(8), randomBytes(8)];

  const U = concat(hash(pw, userValidation, new Uint8Array(0)), userValidation, userKeySalt);
  const UE = aesCbcEncrypt(hash(pw, userKeySalt, new Uint8Array(0)), ZERO_IV, fileKey, false);
  const O = concat(hash(pw, ownerValidation, U), ownerValidation, ownerKeySalt);
  const OE = aesCbcEncrypt(hash(pw, ownerKeySalt, U), ZERO_IV, fileKey, false);

  const perms = new Uint8Array(16);
  new DataView(perms.buffer).setInt32(0, ALL_PERMISSIONS, true);
  perms.fill(0xff, 4, 8);
  perms.set([0x54, 0x61, 0x64, 0x62], 8); // "T" (metadata is encrypted), then "adb"
  perms.set(randomBytes(4), 12);
  return { fileKey, values: { O, U, OE, UE, Perms: aesEcbEncrypt(fileKey, perms), P: ALL_PERMISSIONS } };
}

// The file key when password opens the file as its user or its owner, or null.
export function unlock(password: string, values: Pick<EncryptValues, 'O' | 'U' | 'OE' | 'UE'>): Uint8Array | null {
  const pw = passwordBytes(password);
  const { O, U, OE, UE } = values;
  if (U.length < 48 || O.length < 48 || UE.length < 32 || OE.length < 32) return null;
  const user = U.subarray(0, 48);
  let fileKey: Uint8Array | null = null;
  if (equalBytes(hash(pw, O.subarray(32, 40), user), O.subarray(0, 32))) {
    fileKey = aesCbcDecrypt(hash(pw, O.subarray(40, 48), user), ZERO_IV, OE.subarray(0, 32), false);
  } else if (equalBytes(hash(pw, U.subarray(32, 40), new Uint8Array(0)), U.subarray(0, 32))) {
    fileKey = aesCbcDecrypt(hash(pw, U.subarray(40, 48), new Uint8Array(0)), ZERO_IV, UE.subarray(0, 32), false);
  }
  return fileKey;
}

// Checks /Perms against the file key: a file whose permissions were altered does not open.
export function permsMatch(fileKey: Uint8Array, perms: Uint8Array, p: number): boolean {
  if (perms.length < 16) return false;
  const plain = aesEcbDecrypt(fileKey, perms.subarray(0, 16));
  return plain[9] === 0x61 && plain[10] === 0x64 && plain[11] === 0x62 && new DataView(plain.buffer).getInt32(0, true) === (p | 0);
}

// One string or stream: a random 16-byte IV, then the AES-256-CBC cipher text.
export function encryptData(fileKey: Uint8Array, data: Uint8Array): Uint8Array {
  const iv = randomBytes(16);
  return concat(iv, aesCbcEncrypt(fileKey, iv, data, true));
}

export function decryptData(fileKey: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length < 32) return new Uint8Array(0);
  return aesCbcDecrypt(fileKey, data.subarray(0, 16), data.subarray(16), true);
}
