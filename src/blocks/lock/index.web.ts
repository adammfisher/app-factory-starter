// Browsers have no biometric prompt the app can rely on, so authenticate() resolves "unavailable"
// without asking for anything. The lock timing works as on native: AppState follows tab visibility.
import { useFakes } from '../../env';
import * as fake from './fake';
import { createLock as realCreateLock, type AuthResult } from './lock';

export type { AuthResult, Lock, LockEvent, LockOptions } from './lock';
export { clampGracePeriod, DEFAULT_GRACE_PERIOD, MAX_GRACE_PERIOD, MIN_GRACE_PERIOD } from './lock';

async function webAuthenticate(): Promise<AuthResult> {
  return 'unavailable';
}

const fakes = useFakes();

export const authenticate: () => Promise<AuthResult> = fakes ? fake.authenticate : webAuthenticate;
export const createLock: typeof realCreateLock = fakes ? fake.createLock : realCreateLock;
export const setFakeAuthenticateResult = fake.setFakeAuthenticateResult;
