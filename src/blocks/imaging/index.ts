import { Directory, File, Paths } from 'expo-file-system';

import { useFakes } from '../../env';
import * as fake from './fake';
import { createImaging, newName, type ImagingIo } from './imaging';

export type { Failure, Filter, Image, ImagingError, Rect } from './imaging';

// Results go to the app's cache folder, which the system may clear when space runs low; move an
// image somewhere lasting (the storage block) to keep it.
const io: ImagingIo = {
  read: (path) => new File(path).bytes(),
  write: async (bytes, extension) => {
    const folder = new Directory(Paths.cache, 'imaging');
    folder.create({ intermediates: true, idempotent: true });
    const file = new File(folder, newName(extension));
    file.create();
    file.write(bytes);
    return file.uri;
  },
  remove: async (path) => new File(path).delete(),
};

const real = createImaging(io);
const fakes = useFakes();

export const applyFilter: typeof fake.applyFilter = fakes ? fake.applyFilter : real.applyFilter;
export const crop: typeof fake.crop = fakes ? fake.crop : real.crop;
export const splitHalves: typeof fake.splitHalves = fakes ? fake.splitHalves : real.splitHalves;
export const stack: typeof fake.stack = fakes ? fake.stack : real.stack;
export const resize: typeof fake.resize = fakes ? fake.resize : real.resize;
