// The ai block's device checks, run from the Block Lab against the real implementation.
import { expectThat, type DeviceChecks } from '../../lab/check';
import { download, generate, isFailure, remove, status, summarize } from './index';

const SAMPLE =
  'The lighthouse keeper climbed the stairs at dusk. She lit the lamp, wound the clockwork and ' +
  'logged the weather. Three ships passed in the night, and each one signalled its thanks.';

export const deviceChecks: DeviceChecks = {
  status: async () => {
    const s = await status();
    return expectThat(s, ['builtin', 'downloaded', 'downloadable', 'unavailable'].includes(s), 'Unknown status');
  },
  generate: async () => {
    const r = await generate('Answer in one word.', 'What colour is a clear daytime sky?');
    return expectThat(r, !isFailure(r) && r.trim().length > 0, 'No text from the model');
  },
  summarize: async () => {
    const r = await summarize(SAMPLE);
    return expectThat(r, !isFailure(r) && r.trim().length > 0, 'No summary from the model');
  },
  download: async () => {
    const r = await download();
    return expectThat(r, r === 'downloaded' || r === 'not-needed', 'Model not downloaded');
  },
  remove: async () => {
    const bytes = await remove();
    const after = await status();
    return expectThat({ bytes, after }, after !== 'downloaded', 'Model still present after remove');
  },
};
