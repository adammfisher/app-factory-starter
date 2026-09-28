// The web has no app store to sell through, so nothing is ever unlocked here: price() resolves
// null, buy() and restore() resolve "failed", and none of them contacts RevenueCat.
import { useFakes } from '../../env';
import * as fake from './fake';
import { lockedGiven, paidFeatures, type BuyResult, type RestoreResult } from './features';

export type { BuyResult, RestoreResult } from './features';
export type { FakePurchasesOptions } from './fake';
export { PAID_ENTITLEMENT } from './features';

async function webIsUnlocked(_entitlement: string): Promise<boolean> {
  return false;
}

async function webLockedFeatures(): Promise<readonly string[]> {
  return lockedGiven(() => false);
}

async function webPrice(_entitlement: string): Promise<string | null> {
  return null;
}

async function webBuy(_entitlement: string): Promise<BuyResult> {
  return 'failed';
}

async function webRestore(): Promise<RestoreResult> {
  return 'failed';
}

const fakes = useFakes();

export { paidFeatures };
export const isUnlocked: (entitlement: string) => Promise<boolean> = fakes ? fake.isUnlocked : webIsUnlocked;
export const lockedFeatures: () => Promise<readonly string[]> = fakes ? fake.lockedFeatures : webLockedFeatures;
export const price: (entitlement: string) => Promise<string | null> = fakes ? fake.price : webPrice;
export const buy: (entitlement: string) => Promise<BuyResult> = fakes ? fake.buy : webBuy;
export const restore: () => Promise<RestoreResult> = fakes ? fake.restore : webRestore;
export const setFakePurchases = fake.setFakePurchases;
