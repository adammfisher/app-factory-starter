// The camera block's shared parts: the types, the HEIC check and conversion, and photo import.
// Photo import is the same call on every platform; expo-image-picker opens the photo library on a
// phone and the browser's file picker on web.

export type Image = { path: string; width: number; height: number };
export type Failure = { error: string };
export type Imported = { images: Image[]; dropped: number };

type Source = { uri: string; width: number; height: number; mimeType?: string | null; fileName?: string | null };

// Loaded on first use rather than at import, so with the fakes switch on the native modules are
// never resolved.
function imagePicker(): typeof import('expo-image-picker') {
  return require('expo-image-picker');
}

function imageManipulator(): typeof import('expo-image-manipulator') {
  return require('expo-image-manipulator');
}

const HEIC_TYPE = /^image\/hei[cf]$/i;
const HEIC_NAME = /\.hei[cf]$/i;

export function isHeic(source: Source): boolean {
  return (
    HEIC_TYPE.test(source.mimeType ?? '') || HEIC_NAME.test(source.uri) || HEIC_NAME.test(source.fileName ?? '')
  );
}

// Returns the image as a JPEG file when it is HEIC, and as it is otherwise.
export async function toImage(source: Source): Promise<Image> {
  if (!isHeic(source)) return { path: source.uri, width: source.width, height: source.height };
  const { ImageManipulator, SaveFormat } = imageManipulator();
  const rendered = await ImageManipulator.manipulate(source.uri).renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG });
  return { path: saved.uri, width: saved.width, height: saved.height };
}

export async function importPhotos(limit: number): Promise<Imported | Failure> {
  const max = Math.max(0, Math.floor(limit));
  try {
    const result = await imagePicker().launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      orderedSelection: true,
      selectionLimit: max,
      // Ask iOS for the picture as a JPEG where it can; any HEIC that still arrives is converted.
      preferredAssetRepresentationMode: imagePicker().UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled || !result.assets) return { images: [], dropped: 0 };
    const kept = result.assets.slice(0, max);
    const images: Image[] = [];
    for (const asset of kept) images.push(await toImage(asset));
    return { images, dropped: result.assets.length - kept.length };
  } catch {
    return { error: 'import-failed' };
  }
}
