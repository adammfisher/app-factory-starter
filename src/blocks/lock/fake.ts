// In-memory lock block. authenticate() resolves whatever the test set; the lock timing is the
// real one, since it depends only on AppState.
import { createLock, type AuthResult } from './lock';

let nextResult: AuthResult = 'success';

export function setFakeAuthenticateResult(result: AuthResult): void {
  nextResult = result;
}

export async function authenticate(): Promise<AuthResult> {
  return nextResult;
}

export { createLock };
