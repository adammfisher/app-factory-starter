// Browsers have no share sheet or save dialog the page can wait on, so share() and saveAs()
// download the file and resolve at once. print() loads the PDF into a hidden frame and opens the
// browser's print dialog there; the browser never says whether the person printed, so it resolves
// "printed" once the dialog has closed. open() uses the browser's file picker through
// expo-document-picker.
import { useFakes } from '../../env';
import * as fake from './fake';
import { open as realOpen, type Opened, type Printed, type Saved, type Shared } from './files';

export type { Opened, Picked, Printed, Saved, Shared } from './files';

function download(path: string, name: string): void {
  const link = document.createElement('a');
  link.href = path;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// The last part of the path, for the downloaded file's name. Blob URLs carry no name, so the
// browser picks one when this is empty.
function nameOf(path: string): string {
  if (path.startsWith('blob:') || path.startsWith('data:')) return '';
  const last = path.split(/[?#]/)[0]!.split('/').pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

async function webShare(path: string): Promise<Shared> {
  download(path, nameOf(path));
  return 'shared';
}

async function webSaveAs(path: string, name: string): Promise<Saved> {
  download(path, name);
  return 'saved';
}

function loaded(frame: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
  });
}

// print() blocks in most browsers; where it does not, afterprint says when the dialog has closed.
function afterPrint(target: Window): Promise<void> {
  return new Promise((resolve) => {
    // Browsers that never fire afterprint for a frame still let the caller go on.
    const fallback = setTimeout(() => done(), 60_000);
    const done = () => {
      clearTimeout(fallback);
      target.removeEventListener('afterprint', done);
      resolve();
    };
    target.addEventListener('afterprint', done);
    target.focus();
    target.print();
  });
}

async function webPrint(path: string): Promise<Printed> {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.style.visibility = 'hidden';
  const ready = loaded(frame);
  frame.src = path;
  document.body.appendChild(frame);
  await ready;
  const target = frame.contentWindow;
  if (!target) {
    document.body.removeChild(frame);
    return 'cancelled';
  }
  await afterPrint(target);
  document.body.removeChild(frame);
  return 'printed';
}

const fakes = useFakes();

export const share: (path: string) => Promise<Shared> = fakes ? fake.share : webShare;
export const print: (path: string) => Promise<Printed> = fakes ? fake.print : webPrint;
export const saveAs: (path: string, name: string) => Promise<Saved> = fakes ? fake.saveAs : webSaveAs;
export const open: (types: string[], limit: number) => Promise<Opened> = fakes ? fake.open : realOpen;
export const setFakeCompletes = fake.setFakeCompletes;
export const setFakePicked = fake.setFakePicked;
