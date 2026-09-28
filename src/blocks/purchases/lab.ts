// The purchases block's device checks, run from the Block Lab against the real store. They fail
// until the EXPO_PUBLIC RevenueCat keys are set. Buy with a store sandbox account only: on a real
// account the purchase charges real money.
import { expectResult, expectThat, type DeviceChecks } from '../../lab/check';
import { buy, isUnlocked, PAID_ENTITLEMENT, price, restore } from './index';

export const deviceChecks: DeviceChecks = {
  price: async () => {
    const text = await price(PAID_ENTITLEMENT);
    return expectThat(text, text !== null, 'No price: check the RevenueCat key and the offering');
  },
  buy: async () => {
    expectResult(await buy(PAID_ENTITLEMENT), 'purchased');
    return expectResult(await isUnlocked(PAID_ENTITLEMENT), true);
  },
  restore: async () => {
    const result = await restore();
    return expectThat(result, result !== 'failed', 'Restore could not reach the store');
  },
};
