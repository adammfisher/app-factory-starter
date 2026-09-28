// In-memory purchases block: a store that always answers. Tests set what it sells and how a
// purchase ends; unlocks last until the JavaScript reloads.
import { lockedGiven, PAID_ENTITLEMENT, paidFeatures, type BuyResult, type RestoreResult } from './features';

export type FakePurchasesOptions = { price?: string | null; buyResult?: BuyResult; earlierPurchase?: boolean };

const owned = new Set<string>();
let options: Required<FakePurchasesOptions> = { price: '$4.99', buyResult: 'purchased', earlierPurchase: false };

export function setFakePurchases(next: FakePurchasesOptions): void {
  options = { ...options, ...next };
  if (next.earlierPurchase === false) owned.clear();
}

export async function isUnlocked(entitlement: string): Promise<boolean> {
  return owned.has(entitlement);
}

export async function lockedFeatures(): Promise<readonly string[]> {
  return lockedGiven((entitlement) => owned.has(entitlement));
}

export async function price(_entitlement: string): Promise<string | null> {
  return options.price;
}

export async function buy(entitlement: string): Promise<BuyResult> {
  if (options.buyResult === 'purchased') {
    owned.add(entitlement);
    options = { ...options, earlierPurchase: true };
  }
  return options.buyResult;
}

export async function restore(): Promise<RestoreResult> {
  if (!options.earlierPurchase) return 'nothing-to-restore';
  owned.add(PAID_ENTITLEMENT);
  return 'restored';
}

export { paidFeatures };
