// Browsers have no document camera, so scanDocument() resolves "not-available" without asking for
// anything. importPhotos() opens the browser's file picker through expo-image-picker.
import { useFakes } from '../../env';
import * as fake from './fake';
import { importPhotos as realImportPhotos, type Failure, type Image, type Imported } from './camera';

export type { Failure, Image, Imported } from './camera';

async function webScanDocument(): Promise<Image[] | Failure> {
  return { error: 'not-available' };
}

// A web page cannot open the browser's site settings.
async function webOpenSettings(): Promise<void> {}

const fakes = useFakes();

export const scanDocument: () => Promise<Image[] | Failure> = fakes ? fake.scanDocument : webScanDocument;
export const openSettings: () => Promise<void> = fakes ? fake.openSettings : webOpenSettings;
export const importPhotos: (limit: number) => Promise<Imported | Failure> = fakes ? fake.importPhotos : realImportPhotos;
export const setFakeScan = fake.setFakeScan;
export const setFakePhotos = fake.setFakePhotos;
