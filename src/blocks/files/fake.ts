// In-memory files block. share(), print() and saveAs() complete or cancel as the test set;
// open() chooses whatever the test set, or cancels when it set null.
import { choose, type Opened, type Printed, type Saved, type Shared } from './files';

type Asset = { uri: string; name: string; mimeType?: string };

let completes = true;
let nextPicked: Asset[] | null = [];

export function setFakeCompletes(value: boolean): void {
  completes = value;
}

export function setFakePicked(assets: Asset[] | null): void {
  nextPicked = assets;
}

export async function share(_path: string): Promise<Shared> {
  return completes ? 'shared' : 'cancelled';
}

export async function print(_path: string): Promise<Printed> {
  return completes ? 'printed' : 'cancelled';
}

export async function saveAs(_path: string, _name: string): Promise<Saved> {
  return completes ? 'saved' : 'cancelled';
}

export async function open(types: string[], limit: number): Promise<Opened> {
  if (!nextPicked) return { files: [], skipped: 0 };
  return choose(nextPicked, types, limit);
}
