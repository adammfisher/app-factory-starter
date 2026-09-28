// The platform-independent half of the lock block: the grace period, relock timing and the
// hide-content event. It follows react-native's AppState, which behaves the same on iOS, Android
// and web (where "background" means the tab is hidden).
import { AppState, type AppStateStatus } from 'react-native';

export type AuthResult = 'success' | 'cancelled' | 'unavailable';

// "hide-content" when the app leaves the foreground with lock enabled, so the app can cover what
// the app switcher would show; "show-content" when it returns.
export type LockEvent = 'hide-content' | 'show-content';

export type LockOptions = { enabled: boolean; gracePeriod: number };

export type Lock = {
  readonly enabled: boolean;
  // Seconds, clamped to 0…600.
  readonly gracePeriod: number;
  subscribe: (listener: (event: LockEvent) => void) => () => void;
  // True when the most recent stretch in the background lasted the grace period or longer.
  shouldLock: () => boolean;
  dispose: () => void;
};

export const MIN_GRACE_PERIOD = 0;
export const MAX_GRACE_PERIOD = 600;
export const DEFAULT_GRACE_PERIOD = 60;

export function clampGracePeriod(seconds: number): number {
  if (!Number.isFinite(seconds)) return seconds > 0 ? MAX_GRACE_PERIOD : MIN_GRACE_PERIOD;
  return Math.min(MAX_GRACE_PERIOD, Math.max(MIN_GRACE_PERIOD, seconds));
}

export function createLock(options: LockOptions): Lock {
  const enabled = options.enabled;
  const gracePeriod = clampGracePeriod(options.gracePeriod);
  const listeners = new Set<(event: LockEvent) => void>();
  let backgroundSince: number | null = AppState.currentState === 'background' ? Date.now() : null;
  let lastBackgroundMs: number | null = null;

  const emit = (event: LockEvent) => {
    for (const listener of [...listeners]) listener(event);
  };

  const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'background') {
      if (backgroundSince === null) backgroundSince = Date.now();
    } else if (state === 'active' && backgroundSince !== null) {
      lastBackgroundMs = Date.now() - backgroundSince;
      backgroundSince = null;
    }
    if (!enabled) return;
    if (state === 'inactive' || state === 'background') emit('hide-content');
    else if (state === 'active') emit('show-content');
  });

  return {
    enabled,
    gracePeriod,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    shouldLock() {
      if (!enabled) return false;
      const stretch = backgroundSince !== null ? Date.now() - backgroundSince : lastBackgroundMs;
      return stretch !== null && stretch >= gracePeriod * 1000;
    },
    dispose() {
      subscription.remove();
      listeners.clear();
    },
  };
}
