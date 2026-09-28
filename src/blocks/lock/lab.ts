// The lock block's device checks, run from the Block Lab against the real implementation.
import { expectResult, type DeviceChecks } from '../../lab/check';
import { authenticate, createLock } from './index';

export const deviceChecks: DeviceChecks = {
  authenticate: async () => expectResult(await authenticate(), 'success'),
  // Passes once the app goes to the app switcher or the background and the lock asks to hide
  // content. The Block Lab fails it after its timeout if that never happens.
  'hide-content': () =>
    new Promise<void>((resolve) => {
      const lock = createLock({ enabled: true, gracePeriod: 0 });
      const unsubscribe = lock.subscribe((event) => {
        if (event !== 'hide-content') return;
        unsubscribe();
        lock.dispose();
        resolve();
      });
    }),
};
