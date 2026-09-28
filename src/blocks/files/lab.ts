// The files block's device checks, run from the Block Lab against the real implementation. The
// share, print and save checks use a PDF the person picks the first time one is needed.
import { expectResult, expectThat, type DeviceChecks } from '../../lab/check';
import { open, print, saveAs, share, type Picked } from './index';

const PDF = ['application/pdf'];
let sample: Picked | null = null;

async function samplePdf(): Promise<Picked> {
  if (sample) return sample;
  const r = await open(PDF, 1);
  const picked = expectThat(r, r.files.length > 0, 'Pick a PDF to use for the checks').files[0]!;
  sample = picked;
  return picked;
}

export const deviceChecks: DeviceChecks = {
  share: async () => expectResult(await share((await samplePdf()).path), 'shared'),
  'share-cancel': async () => expectResult(await share((await samplePdf()).path), 'cancelled'),
  print: async () => expectResult(await print((await samplePdf()).path), 'printed'),
  'print-cancel': async () => expectResult(await print((await samplePdf()).path), 'cancelled'),
  'save-as': async () => {
    const pdf = await samplePdf();
    return expectResult(await saveAs(pdf.path, pdf.name), 'saved');
  },
  'save-as-cancel': async () => {
    const pdf = await samplePdf();
    return expectResult(await saveAs(pdf.path, pdf.name), 'cancelled');
  },
  open: async () => {
    const r = await open(PDF, 1);
    return expectThat(r, r.files.length === 1 && r.skipped === 0, 'Pick one PDF');
  },
  'open-skipped': async () => {
    const r = await open(PDF, 1);
    return expectThat(r, r.skipped > 0, 'Pick a file that is not a PDF, or two PDFs');
  },
};
