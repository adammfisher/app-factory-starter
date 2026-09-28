import { useFakes } from '../../env';
import * as fake from './fake';
import { paidFeatures, type BuyResult, type RestoreResult } from './features';
import * as store from './store';

export type { BuyResult, RestoreResult } from './features';
export type { FakePurchasesOptions } from './fake';
export { PAID_ENTITLEMENT } from './features';

const fakes = useFakes();

export { paidFeatures };
export const isUnlocked: (entitlement: string) => Promise<boolean> = fakes ? fake.isUnlocked : store.isUnlocked;
export const lockedFeatures: () => Promise<readonly string[]> = fakes ? fake.lockedFeatures : store.lockedFeatures;
export const price: (entitlement: string) => Promise<string | null> = fakes ? fake.price : store.price;
export const buy: (entitlement: string) => Promise<BuyResult> = fakes ? fake.buy : store.buy;
export const restore: () => Promise<RestoreResult> = fakes ? fake.restore : store.restore;
export const setFakePurchases = fake.setFakePurchases;
