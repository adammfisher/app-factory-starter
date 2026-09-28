// The files block's shared parts: the types and open(). Choosing files is the same call on every
// platform; expo-document-picker opens the phone's document picker and the browser's file picker.

export type Shared = 'shared' | 'cancelled';
export type Printed = 'printed' | 'cancelled';
export type Saved = 'saved' | 'cancelled';
export type Picked = { path: string; name: string; type: string };
export type Opened = { files: Picked[]; skipped: number };

type Asset = { uri: string; name: string; mimeType?: string | null };

// Loaded on first use rather than at import, so with the fakes switch on the native module is never
// resolved.
function documentPicker(): typeof import('expo-document-picker') {
  return require('expo-document-picker');
}

// Files of the wrong type are left out first, then those beyond limit; both count as skipped.
export function choose(assets: Asset[], types: string[], limit: number): Opened {
  const max = Math.max(0, Math.floor(limit));
  const allowed = assets
    .filter((a) => typeof a.mimeType === 'string' && types.includes(a.mimeType))
    .map((a) => ({ path: a.uri, name: a.name, type: a.mimeType as string }));
  const files = allowed.slice(0, max);
  return { files, skipped: assets.length - files.length };
}

export async function open(types: string[], limit: number): Promise<Opened> {
  const result = await documentPicker().getDocumentAsync({
    type: types.length > 0 ? types : '*/*',
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets) return { files: [], skipped: 0 };
  return choose(result.assets, types, limit);
}
