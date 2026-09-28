// The storage block's device checks, run from the Block Lab against the real implementation. They
// use a store of their own, so the app's data is never touched.
import { expectResult, expectThat, type DeviceChecks } from '../../lab/check';
import { open } from './index';

const LAB = { name: 'block-lab-storage' };

export const deviceChecks: DeviceChecks = {
  records: async () => {
    let store = await open(LAB);
    await store.save('lab', { id: 'd1', title: 'Block Lab' });
    await store.close();
    store = await open(LAB);
    const found = await store.get('lab', 'd1');
    expectResult(found?.title, 'Block Lab');
    await store.remove('lab', 'd1');
    const left = await store.list('lab');
    await store.close();
    return expectThat(left, left.length === 0, 'Expected the record to be removed');
  },
  settings: async () => {
    let store = await open(LAB);
    await store.setSetting('sort', 'name');
    await store.close();
    store = await open(LAB);
    const sort = await store.getSetting('sort', 'date');
    await store.close();
    return expectResult(sort, 'name');
  },
  files: async () => {
    const store = await open(LAB);
    await store.saveFile('lab.bin', new Uint8Array(1_000).fill(1));
    const before = await store.usedBytes();
    await store.deleteFile('lab.bin');
    const after = await store.usedBytes();
    await store.close();
    return expectResult(before - after, 1_000);
  },
  'not-enough-space': async () => {
    const store = await open({ ...LAB, minFreeBytes: Number.MAX_SAFE_INTEGER });
    const r = await store.saveFile('too-big.bin', new Uint8Array(1));
    await store.close();
    return expectThat(r, (r as { error?: string } | undefined)?.error === 'not-enough-space', 'Expected "not-enough-space"');
  },
  archive: async () => {
    const from = await open({ name: 'block-lab-storage-archive-from' });
    await from.save('lab', { id: 'a1', title: 'Archived' });
    const uri = await from.exportArchive();
    await from.remove('lab', 'a1');
    await from.close();
    if (typeof uri !== 'string') return expectThat(uri, false, 'Expected an archive URI');
    const into = await open({ name: 'block-lab-storage-archive-into' });
    await into.remove('lab', 'a1');
    const counts = await into.importArchive(uri);
    const found = await into.get('lab', 'a1');
    await into.remove('lab', 'a1');
    await into.close();
    const ok = 'added' in counts && counts.added === 1 && counts.skipped === 0 && found?.title === 'Archived';
    return expectThat(counts, ok, 'Expected the archived record to be imported');
  },
};
