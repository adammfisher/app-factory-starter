import { useFakes } from '../../env';
import { strings } from '../../strings';
import * as fake from './fake';
import { createLock as realCreateLock, type AuthResult } from './lock';

export type { AuthResult, Lock, LockEvent, LockOptions } from './lock';
export { clampGracePeriod, DEFAULT_GRACE_PERIOD, MAX_GRACE_PERIOD, MIN_GRACE_PERIOD } from './lock';

const UNAVAILABLE: readonly string[] = ['not_enrolled', 'not_available', 'passcode_not_set', 'no_space', 'invalid_context'];

// Loaded on first use rather than at import, so with the fakes switch on the native module is
// never resolved. (Jest caches a resolved module per importing file across test files in a
// worker; resolving it early would bypass a later test's virtual mock.)
function localAuthentication(): typeof import('expo-local-authentication') {
  return require('expo-local-authentication');
}

// Asks for Face ID, Touch ID or a fingerprint. The device fallback stays on, so when biometrics
// fail the system offers the phone passcode; a phone with only a passcode gets the passcode.
async function realAuthenticate(): Promise<AuthResult> {
  try {
    const LocalAuthentication = localAuthentication();
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) return 'unavailable';
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: strings.lock.prompt,
      cancelLabel: strings.lock.cancel,
      disableDeviceFallback: false,
    });
    if (result.success) return 'success';
    return UNAVAILABLE.includes(result.error) ? 'unavailable' : 'cancelled';
  } catch {
    return 'unavailable';
  }
}

const fakes = useFakes();

export const authenticate: () => Promise<AuthResult> = fakes ? fake.authenticate : realAuthenticate;
export const createLock: typeof realCreateLock = fakes ? fake.createLock : realCreateLock;
export const setFakeAuthenticateResult = fake.setFakeAuthenticateResult;
