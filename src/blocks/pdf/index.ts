import { Directory, File, Paths } from 'expo-file-system';

import { useFakes } from '../../env';
import * as fake from './fake';
import { createPdf, newName, type PdfIo } from './pdf';

export type { Failure, Image, Page, PageSize, PdfError, WriteOptions, Written } from './pdf';
export { MAX_PASSWORD, MIN_PASSWORD } from './pdf';

// PDFs go to the app's documents folder, which lasts until the app deletes them. The PDF is
// built in JavaScript here too, until the native PDFKit and PdfBox-Android writers land.
const io: PdfIo = {
  read: (path) => new File(path).bytes(),
  write: async (bytes) => {
    const folder = new Directory(Paths.document, 'pdf');
    folder.create({ intermediates: true, idempotent: true });
    const file = new File(folder, newName());
    file.create();
    try {
      file.write(bytes);
    } catch (e) {
      file.delete();
      throw e;
    }
    return file.uri;
  },
};

const real = createPdf(io);
const fakes = useFakes();

export const write: typeof fake.write = fakes ? fake.write : real.write;
export const readText: typeof fake.readText = fakes ? fake.readText : real.readText;
