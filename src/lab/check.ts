// Helpers for the device checks in each block's lab.ts. A check passes when it resolves and fails
// when it throws; the message is what the Block Lab shows under Fail. These messages are for the
// developer running the lab, not for the app's users.

export type DeviceChecks = Record<string, () => Promise<unknown>>;

function show(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
}

// Throws unless actual is expected.
export function expectResult<T>(actual: T, expected: T): T {
  if (actual !== expected) throw new Error(`Expected ${show(expected)}, got ${show(actual)}`);
  return actual;
}

// Throws with message, followed by what came back, unless ok is true.
export function expectThat<T>(actual: T, ok: boolean, message: string): T {
  if (!ok) throw new Error(`${message} (got ${show(actual)})`);
  return actual;
}
