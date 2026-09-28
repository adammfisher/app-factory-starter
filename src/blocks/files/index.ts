import { requireOptionalNativeModule } from 'expo-modules-core';

import { useFakes } from '../../env';
import * as fake from './fake';
import { open as realOpen, type Opened, type Printed, type Saved, type Shared } from './files';

export type { Opened, Picked, Printed, Saved, Shared } from './files';

type FileExchange = {
  shareAsync(uri: string): Promise<boolean>;
  printAsync(uri: string): Promise<boolean>;
  saveAsAsync(uri: string, name: string): Promise<boolean>;
};

// The phone's share sheet, print dialog and save dialog. Each resolves true when the person went
// through with it and false when they dismissed it. Looked up on each call, so a build without the
// module resolves "cancelled" instead of failing at import.
function fileExchange(): FileExchange | null {
  return requireOptionalNativeModule<FileExchange>('FileExchange');
}

async function realShare(path: string): Promise<Shared> {
  const exchange = fileExchange();
  return exchange && (await exchange.shareAsync(path)) ? 'shared' : 'cancelled';
}

async function realPrint(path: string): Promise<Printed> {
  const exchange = fileExchange();
  return exchange && (await exchange.printAsync(path)) ? 'printed' : 'cancelled';
}

async function realSaveAs(path: string, name: string): Promise<Saved> {
  const exchange = fileExchange();
  return exchange && (await exchange.saveAsAsync(path, name)) ? 'saved' : 'cancelled';
}

const fakes = useFakes();

export const share: (path: string) => Promise<Shared> = fakes ? fake.share : realShare;
export const print: (path: string) => Promise<Printed> = fakes ? fake.print : realPrint;
export const saveAs: (path: string, name: string) => Promise<Saved> = fakes ? fake.saveAs : realSaveAs;
export const open: (types: string[], limit: number) => Promise<Opened> = fakes ? fake.open : realOpen;
export const setFakeCompletes = fake.setFakeCompletes;
export const setFakePicked = fake.setFakePicked;
