// The camera block's device checks, run from the Block Lab against the real implementation. Each
// needs the person holding the phone: scan a page, cancel, deny the camera in Settings first, pick
// photos, pick a HEIC photo.
import { expectThat, type DeviceChecks } from '../../lab/check';
import { importPhotos, scanDocument } from './index';

const HEIC = /\.hei[cf]$/i;

export const deviceChecks: DeviceChecks = {
  scan: async () => {
    const r = await scanDocument();
    return expectThat(r, Array.isArray(r) && r.length > 0, 'Scan a page');
  },
  'scan-cancel': async () => {
    const r = await scanDocument();
    return expectThat(r, Array.isArray(r) && r.length === 0, 'Cancel the scan');
  },
  'camera-denied': async () => {
    const r = await scanDocument();
    return expectThat(r, !Array.isArray(r) && r.error === 'camera-denied', 'Deny camera access, then run');
  },
  'import-photos': async () => {
    const r = await importPhotos(3);
    return expectThat(r, 'images' in r && r.images.length > 0, 'Pick up to 3 photos');
  },
  heic: async () => {
    const r = await importPhotos(1);
    const image = 'images' in r ? r.images[0] : undefined;
    return expectThat(r, !!image && !HEIC.test(image.path) && image.width > 0, 'Pick a HEIC photo; it should arrive as JPEG');
  },
};
