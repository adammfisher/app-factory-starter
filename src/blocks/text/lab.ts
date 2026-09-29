// The text block's device checks, run from the Block Lab against the real implementation.
import { Asset } from 'expo-asset';

import { expectResult, expectThat, type DeviceChecks } from '../../lab/check';
import { downloadLanguage, isFailure, languages, recognize, translate, type Language } from './index';

async function languageList(): Promise<Language[]> {
  const r = await languages();
  return expectThat(r, !isFailure(r) && r.length > 0, 'No languages') as Language[];
}

export const deviceChecks: DeviceChecks = {
  // Reads a printed invoice bundled with the lab. The asset is copied to a file first: in a
  // development build it is served by the bundler, and the recognizer reads files only.
  recognize: async () => {
    const asset = await Asset.fromModule(require('./lab-invoice.png')).downloadAsync();
    const path = asset.localUri ?? asset.uri;
    const r = await recognize({ path, width: asset.width ?? 0, height: asset.height ?? 0 });
    const found = Array.isArray(r) && r.some((line) => line.includes('Invoice 4417'));
    return expectThat(r, found, 'Expected a line reading "Invoice 4417"');
  },
  languages: languageList,
  translate: async () => {
    const language = (await languageList()).find((l) => l.downloaded);
    if (!language) throw new Error('No language downloaded; run download-language first');
    const r = await translate('Good morning', language.code);
    return expectThat(r, typeof r === 'string' && r.trim().length > 0, `No translation into ${language.code}`);
  },
  'download-language': async () => {
    const language = (await languageList()).find((l) => !l.downloaded);
    if (!language) return 'every language already downloaded';
    return expectResult(await downloadLanguage(language.code), 'downloaded');
  },
};
