// The contract these tests hold the lock block to:
// - src/blocks/lock/index.ts (and index.web.ts) export:
//   - authenticate(): Promise<"success" | "cancelled" | "unavailable">, built on expo-local-authentication.
//     It never disables the device fallback, so the phone passcode is offered when biometrics fail.
//   - createLock({ enabled: boolean, gracePeriod: number }): Lock, where
//     - lock.gracePeriod is the grace period in seconds, clamped to 0…600;
//     - lock.subscribe(listener) calls listener(event) for each event the block emits and returns an
//       unsubscribe function;
//     - lock.shouldLock() is true when the most recent stretch in the background lasted the grace
//       period or longer;
//     - lock.dispose() stops listening to AppState.
//   The lock follows react-native's AppState "change" events.
// - index.web.ts's authenticate() resolves "unavailable" without asking for anything.

type AuthResult = 'success' | 'cancelled' | 'unavailable';
type Lock = {
  gracePeriod: number;
  subscribe: (listener: (event: string) => void) => () => void;
  shouldLock: () => boolean;
  dispose: () => void;
};
type LockBlock = {
  authenticate: () => Promise<AuthResult>;
  createLock: (options: { enabled: boolean; gracePeriod: number }) => Lock;
};
type AuthOptions = { disableDeviceFallback?: boolean } | undefined;
type AuthResponse = { success: true } | { success: false; error: string };

const mockLocalAuth = {
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  getEnrolledLevelAsync: jest.fn(),
  supportedAuthenticationTypesAsync: jest.fn(),
  authenticateAsync: jest.fn(),
  cancelAuthenticate: jest.fn(),
};

jest.mock(
  'expo-local-authentication',
  () => ({
    ...mockLocalAuth,
    AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
    SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  }),
  { virtual: true },
);

const RESULTS: AuthResult[] = ['success', 'cancelled', 'unavailable'];

function phoneWithFaceId(authenticate: (options: AuthOptions) => AuthResponse): void {
  mockLocalAuth.hasHardwareAsync.mockResolvedValue(true);
  mockLocalAuth.isEnrolledAsync.mockResolvedValue(true);
  mockLocalAuth.getEnrolledLevelAsync.mockResolvedValue(3);
  mockLocalAuth.supportedAuthenticationTypesAsync.mockResolvedValue([2]);
  mockLocalAuth.authenticateAsync.mockImplementation(async (options: AuthOptions) => authenticate(options));
}

function phoneWithNoLock(): void {
  mockLocalAuth.hasHardwareAsync.mockResolvedValue(false);
  mockLocalAuth.isEnrolledAsync.mockResolvedValue(false);
  mockLocalAuth.getEnrolledLevelAsync.mockResolvedValue(0);
  mockLocalAuth.supportedAuthenticationTypesAsync.mockResolvedValue([]);
  mockLocalAuth.authenticateAsync.mockResolvedValue({ success: false, error: 'not_available' });
}

let changeHandlers: ((state: string) => void)[] = [];
let AppState: { currentState: unknown };

// Loads a fresh copy of the block with AppState listeners captured.
function load(entry: 'index' | 'index.web' = 'index'): LockBlock {
  jest.resetModules();
  changeHandlers = [];
  const rn = require('react-native');
  AppState = rn.AppState;
  jest.spyOn(rn.AppState, 'addEventListener').mockImplementation((...args: unknown[]) => {
    const [type, handler] = args as [string, (state: string) => void];
    if (type === 'change') changeHandlers.push(handler);
    return { remove: jest.fn() };
  });
  return require(`../src/blocks/lock/${entry}`) as LockBlock;
}

function changeAppState(state: string): void {
  AppState.currentState = state;
  for (const handler of [...changeHandlers]) handler(state);
}

function backgroundFor(seconds: number): void {
  changeAppState('background');
  jest.advanceTimersByTime(seconds * 1000);
  changeAppState('active');
}

const created: Lock[] = [];
function createLock(block: LockBlock, options: { enabled: boolean; gracePeriod: number }): Lock {
  const lock = block.createLock(options);
  created.push(lock);
  return lock;
}

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_USE_FAKES;
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-01-01T12:00:00Z'));
});

afterEach(() => {
  for (const lock of created.splice(0)) lock.dispose();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('F003 lock block', () => {
  it('authenticate() resolves "success", "cancelled" or "unavailable", and offers the phone passcode when biometrics fail.', async () => {
    phoneWithFaceId(() => ({ success: true }));
    expect(await load().authenticate()).toBe('success');

    phoneWithFaceId(() => ({ success: false, error: 'user_cancel' }));
    expect(await load().authenticate()).toBe('cancelled');

    phoneWithNoLock();
    expect(await load().authenticate()).toBe('unavailable');

    for (const error of ['authentication_failed', 'lockout', 'user_fallback', 'system_cancel', 'app_cancel', 'timeout', 'unknown']) {
      phoneWithFaceId(() => ({ success: false, error }));
      expect(RESULTS).toContain(await load().authenticate());
    }

    // Face ID fails; the system then offers the passcode, which the person enters.
    mockLocalAuth.authenticateAsync.mockClear();
    phoneWithFaceId((options) => (options?.disableDeviceFallback ? { success: false, error: 'lockout' } : { success: true }));
    expect(await load().authenticate()).toBe('success');
    const calls = mockLocalAuth.authenticateAsync.mock.calls as [AuthOptions][];
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some(([options]) => options?.disableDeviceFallback !== true)).toBe(true);
  });

  it('With a 60-second grace period, shouldLock returns true after 60 or more seconds in the background and false after 59 seconds.', () => {
    const block = load();

    const short = createLock(block, { enabled: true, gracePeriod: 60 });
    backgroundFor(59);
    expect(short.shouldLock()).toBe(false);

    for (const seconds of [60, 61, 3600]) {
      const lock = createLock(block, { enabled: true, gracePeriod: 60 });
      backgroundFor(seconds);
      expect({ seconds, shouldLock: lock.shouldLock() }).toEqual({ seconds, shouldLock: true });
    }
  });

  it('The grace period accepts 0 to 600 seconds; a value below 0 becomes 0 and a value above 600 becomes 600.', () => {
    const block = load();
    const cases: [number, number][] = [
      [0, 0],
      [1, 1],
      [300, 300],
      [600, 600],
      [-1, 0],
      [-500, 0],
      [601, 600],
      [10000, 600],
    ];
    for (const [given, expected] of cases) {
      const lock = createLock(block, { enabled: true, gracePeriod: given });
      expect({ given, gracePeriod: lock.gracePeriod }).toEqual({ given, gracePeriod: expected });
    }

    const zero = createLock(block, { enabled: true, gracePeriod: -30 });
    backgroundFor(0);
    expect(zero.shouldLock()).toBe(true);

    const capped = createLock(block, { enabled: true, gracePeriod: 900 });
    backgroundFor(599);
    expect(capped.shouldLock()).toBe(false);
    backgroundFor(600);
    expect(capped.shouldLock()).toBe(true);
  });

  it('When the app state changes to inactive or background with lock enabled, the block emits "hide-content" in that same state change.', () => {
    const block = load();

    for (const state of ['inactive', 'background']) {
      changeAppState('active');
      const lock = createLock(block, { enabled: true, gracePeriod: 60 });
      const events: string[] = [];
      lock.subscribe((event) => events.push(event));

      changeAppState('active');
      expect(events).not.toContain('hide-content');

      changeAppState(state);
      expect({ state, events }).toEqual({ state, events: expect.arrayContaining(['hide-content']) });
    }

    changeAppState('active');
    const disabled = createLock(block, { enabled: false, gracePeriod: 60 });
    const disabledEvents: string[] = [];
    disabled.subscribe((event) => disabledEvents.push(event));
    changeAppState('inactive');
    changeAppState('background');
    expect(disabledEvents).not.toContain('hide-content');
  });

  it('On web, authenticate() resolves "unavailable".', async () => {
    phoneWithFaceId(() => ({ success: true }));
    const web = load('index.web');
    expect(await web.authenticate()).toBe('unavailable');
  });
});
