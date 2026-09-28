// In-memory camera block. scanDocument() and importPhotos() resolve whatever the test set.
import type { Failure, Image, Imported } from './camera';

let nextScan: Image[] | Failure = [];
let nextPhotos: Image[] = [];

export function setFakeScan(result: Image[] | Failure): void {
  nextScan = result;
}

export function setFakePhotos(images: Image[]): void {
  nextPhotos = images;
}

export async function scanDocument(): Promise<Image[] | Failure> {
  return Array.isArray(nextScan) ? nextScan.map((i) => ({ ...i })) : { ...nextScan };
}

export async function openSettings(): Promise<void> {}

export async function importPhotos(limit: number): Promise<Imported> {
  const max = Math.max(0, Math.floor(limit));
  const images = nextPhotos.slice(0, max).map((i) => ({ ...i }));
  return { images, dropped: nextPhotos.length - images.length };
}
