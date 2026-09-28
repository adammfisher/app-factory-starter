// The app's paid features, declared here and nowhere else. Every one of them is unlocked by the
// entitlement below. Replace the placeholder with the app's own feature names.
export const PAID_ENTITLEMENT = 'pro';

export const paidFeatures: readonly string[] = Object.freeze(['pro-example']);

export type BuyResult = 'purchased' | 'cancelled' | 'pending' | 'failed';
export type RestoreResult = 'restored' | 'nothing-to-restore' | 'failed';

// The paid features still locked, in paidFeatures order.
export function lockedGiven(isOwned: (entitlement: string) => boolean): readonly string[] {
  return isOwned(PAID_ENTITLEMENT) ? [] : [...paidFeatures];
}
