// The real purchases block on iOS and Android: RevenueCat for the store, and the device's secure
// store for the last known unlocks, so they hold after a restart while the store cannot be reached.
//
// Nothing starts at import. The first call reads the kept unlocks, configures RevenueCat with the
// platform's EXPO_PUBLIC key (never, when the key is empty), listens for the store's reports and
// asks for the customer's record. When the store answers, its active entitlements replace the kept
// ones, so a refund or revoked grant locks again once the store is reachable.
import { Platform } from 'react-native';
import type { CustomerInfo, PurchasesPackage } from 'react-native-purchases';
import { env } from '../../env';
import { lockedGiven, PAID_ENTITLEMENT, type BuyResult, type RestoreResult } from './features';

const KEPT_KEY = 'purchases.entitlements';

type PurchasesModule = typeof import('react-native-purchases');

// Loaded on first use, so with the fakes switch on (or no key) the native module is never resolved.
function purchasesModule(): PurchasesModule {
  return require('react-native-purchases');
}

function secureStore(): typeof import('expo-secure-store') {
  return require('expo-secure-store');
}

function apiKey(): string {
  if (Platform.OS === 'ios') return env.revenueCatIosKey;
  if (Platform.OS === 'android') return env.revenueCatAndroidKey;
  return '';
}

const owned = new Set<string>();
let configured = false;
let started: Promise<void> | null = null;
let writing: Promise<void> = Promise.resolve();

async function readKept(): Promise<string[]> {
  try {
    const text = await secureStore().getItemAsync(KEPT_KEY);
    const list: unknown = text ? JSON.parse(text) : [];
    return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

// Writes run one after another, so the last report is the one kept.
function keep(): void {
  const text = JSON.stringify([...owned]);
  writing = writing.then(() => secureStore().setItemAsync(KEPT_KEY, text)).catch(() => undefined);
}

function apply(info: CustomerInfo): void {
  owned.clear();
  for (const entitlement of Object.keys(info.entitlements.active)) owned.add(entitlement);
  keep();
}

async function boot(): Promise<void> {
  for (const entitlement of await readKept()) owned.add(entitlement);
  const key = apiKey();
  if (!key) return;
  try {
    const Purchases = purchasesModule().default;
    Purchases.configure({ apiKey: key });
    configured = true;
    Purchases.addCustomerInfoUpdateListener(apply);
    // Not awaited: without a network the kept unlocks answer until the store does.
    Purchases.getCustomerInfo().then(apply, () => undefined);
  } catch {
    configured = false;
  }
}

function start(): Promise<void> {
  started ??= boot();
  return started;
}

async function sellingPackage(entitlement: string): Promise<PurchasesPackage | null> {
  const offerings = await purchasesModule().default.getOfferings();
  return offerings.all[entitlement]?.availablePackages[0] ?? offerings.current?.availablePackages[0] ?? null;
}

function buyError(error: unknown): BuyResult {
  const { PURCHASES_ERROR_CODE } = purchasesModule();
  const { code, userCancelled } = (error ?? {}) as { code?: unknown; userCancelled?: unknown };
  if (userCancelled === true || code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return 'cancelled';
  if (code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return 'pending';
  return 'failed';
}

export async function isUnlocked(entitlement: string): Promise<boolean> {
  await start();
  return owned.has(entitlement);
}

export async function lockedFeatures(): Promise<readonly string[]> {
  await start();
  return lockedGiven((entitlement) => owned.has(entitlement));
}

export async function price(entitlement: string): Promise<string | null> {
  await start();
  if (!configured) return null;
  try {
    return (await sellingPackage(entitlement))?.product.priceString ?? null;
  } catch {
    return null;
  }
}

export async function buy(entitlement: string): Promise<BuyResult> {
  await start();
  if (!configured) return 'failed';
  try {
    const pkg = await sellingPackage(entitlement);
    if (!pkg) return 'failed';
    const { customerInfo } = await purchasesModule().default.purchasePackage(pkg);
    apply(customerInfo);
    return owned.has(entitlement) ? 'purchased' : 'failed';
  } catch (error) {
    return buyError(error);
  }
}

export async function restore(): Promise<RestoreResult> {
  await start();
  if (!configured) return 'failed';
  try {
    apply(await purchasesModule().default.restorePurchases());
    return owned.has(PAID_ENTITLEMENT) ? 'restored' : 'nothing-to-restore';
  } catch {
    return 'failed';
  }
}
