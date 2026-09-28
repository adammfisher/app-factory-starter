import { Linking } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

import { useFakes } from '../../env';
import * as fake from './fake';
import { importPhotos as realImportPhotos, toImage, type Failure, type Image, type Imported } from './camera';

export type { Failure, Image, Imported } from './camera';

type Page = { uri: string; width: number; height: number };
type DocumentScanner = {
  requestPermissionAsync(): Promise<boolean>;
  scanAsync(): Promise<Page[]>;
};

// The phone's document camera: VisionKit on iOS, ML Kit's document scanner on Android. Looked up on
// each scan, so a build without the module reports "not-available" instead of failing at import.
function documentScanner(): DocumentScanner | null {
  return requireOptionalNativeModule<DocumentScanner>('DocumentScanner');
}

function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
}

async function realScanDocument(): Promise<Image[] | Failure> {
  const scanner = documentScanner();
  if (!scanner) return { error: 'not-available' };
  try {
    if (!(await scanner.requestPermissionAsync())) return { error: 'camera-denied' };
    const pages = await scanner.scanAsync();
    const images: Image[] = [];
    for (const page of pages) images.push(await toImage(page));
    return images;
  } catch (error) {
    const code = codeOf(error);
    if (code === 'ERR_CANCELLED') return [];
    if (code === 'ERR_CAMERA_DENIED') return { error: 'camera-denied' };
    return { error: 'scan-failed' };
  }
}

async function realOpenSettings(): Promise<void> {
  await Linking.openSettings();
}

const fakes = useFakes();

export const scanDocument: () => Promise<Image[] | Failure> = fakes ? fake.scanDocument : realScanDocument;
export const openSettings: () => Promise<void> = fakes ? fake.openSettings : realOpenSettings;
export const importPhotos: (limit: number) => Promise<Imported | Failure> = fakes ? fake.importPhotos : realImportPhotos;
export const setFakeScan = fake.setFakeScan;
export const setFakePhotos = fake.setFakePhotos;
