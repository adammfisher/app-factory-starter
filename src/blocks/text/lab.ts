// The text block's device checks, run from the Block Lab against the real implementation.
import { Image as NativeImage } from 'react-native';

import { expectResult, expectThat, type DeviceChecks } from '../../lab/check';
import { downloadLanguage, isFailure, languages, recognize, translate, type Language } from './index';

async function languageList(): Promise<Language[]> {
  const r = await languages();
  return expectThat(r, !isFailure(r) && r.length > 0, 'No languages') as Language[];
}

export const deviceChecks: DeviceChecks = {
  // Proves the recognizer runs on the phone; the app icon may hold no text, so no lines is a pass.
  recognize: async () => {
    const source = NativeImage.resolveAssetSource(require('../../../assets/icon.png'));
    const r = await recognize({ path: source.uri, width: source.width, height: source.height });
    return expectThat(r, Array.isArray(r), 'Recognizer failed');
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
