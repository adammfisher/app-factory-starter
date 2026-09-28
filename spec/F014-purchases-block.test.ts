// The contract these tests hold the purchases block to:
// - src/blocks/purchases/index.ts (and index.web.ts) export:
//   - paidFeatures: the app's paid feature names, a non-empty list of distinct strings, all unlocked
//     by the entitlement "pro". It is declared once: each name is written as a string literal in
//     exactly one file under src/blocks/purchases, and index.web.ts exports the same list.
//   - isUnlocked(entitlement): boolean (or a Promise of one).
//   - lockedFeatures(): the paid features not yet unlocked, in paidFeatures order (or a Promise).
//   - price(entitlement): resolves the store's localized price text (product.priceString), or null.
//   - buy(entitlement): resolves "purchased" | "cancelled" | "pending" | "failed".
//   - restore(): resolves "nothing-to-restore" when the store reports no earlier purchase of "pro",
//     and something else once "pro" is unlocked.
// - The store is RevenueCat through react-native-purchases (default export Purchases). The block
//   configures it itself, the first time it is needed, with Purchases.configure({ apiKey }), where the
//   key is EXPO_PUBLIC_REVENUECAT_IOS_KEY on iOS and EXPO_PUBLIC_REVENUECAT_ANDROID_KEY on Android.
//   With no key it never configures, and every other Purchases call fails until it does.
// - The store reports entitlements through CustomerInfo: entitlements.active["pro"] is present when
//   "pro" is owned. CustomerInfo comes from getCustomerInfo(), from the listener passed to
//   addCustomerInfoUpdateListener, from purchasePackage(pkg) / purchaseStoreProduct(product)
//   ({ customerInfo }) and from restorePurchases().
// - The package that sells "pro" is the first package of getOfferings().all["pro"], or of
//   getOfferings().current. Its product.priceString is the price text.
// - Purchase errors carry RevenueCat's code: PURCHASE_CANCELLED_ERROR ("1", userCancelled true) is
//   "cancelled", PAYMENT_PENDING_ERROR ("20") is "pending", anything else is "failed".
// - An unlock is kept on the device with @react-native-async-storage/async-storage or
//   expo-secure-store, so it holds after a restart while the store cannot be reached.
// - index.web.ts: price resolves null and buy resolves "failed", without calling the store.

type BuyResult = 'purchased' | 'cancelled' | 'pending' | 'failed';
type PurchasesBlock = {
  paidFeatures: readonly string[];
  isUnlocked: (entitlement: string) => boolean | Promise<boolean>;
  lockedFeatures: () => readonly string[] | Promise<readonly string[]>;
  price: (entitlement: string) => string | null | Promise<string | null>;
  buy: (entitlement: string) => Promise<BuyResult>;
  restore: () => Promise<string>;
};
type CustomerInfo = {
  entitlements: { active: Record<string, unknown>; all: Record<string, unknown> };
  activeSubscriptions: string[];
  allPurchasedProductIdentifiers: string[];
  nonSubscriptionTransactions: unknown[];
  originalAppUserId: string;
};
type Listener = (info: CustomerInfo) => void;
type Outcome = 'purchased' | 'cancelled' | 'pending' | 'failed' | 'offline';

const ERROR = {
  PURCHASE_CANCELLED_ERROR: '1',
  STORE_PROBLEM_ERROR: '2',
  PURCHASE_NOT_ALLOWED_ERROR: '3',
  NETWORK_ERROR: '10',
  PAYMENT_PENDING_ERROR: '20',
  UNKNOWN_ERROR: '0',
};

// Named mock… so jest.mock factories may use them.

// The RevenueCat backend and the phone's store account. It outlives restarts.
const mockStore = {
  reachable: true,
  owned: false, // "pro" is on the current customer's record
  earlierPurchase: false, // bought before on this store account, found by a restore
  outcome: 'purchased' as Outcome,
  priceString: '4,99 €',
  configuredWith: [] as string[],
  // Per launch of the app: the SDK instance.
  configured: false,
  listeners: [] as Listener[],
};

function mockInfo(): CustomerInfo {
  const pro = {
    identifier: 'pro',
    isActive: true,
    willRenew: false,
    periodType: 'NORMAL',
    productIdentifier: 'pro_unlock',
    isSandbox: true,
    store: 'APP_STORE',
    latestPurchaseDate: '2026-09-01T12:00:00Z',
    originalPurchaseDate: '2026-09-01T12:00:00Z',
    expirationDate: null,
  };
  return {
    entitlements: { active: mockStore.owned ? { pro } : {}, all: mockStore.owned ? { pro } : {} },
    activeSubscriptions: [],
    allPurchasedProductIdentifiers: mockStore.owned ? ['pro_unlock'] : [],
    nonSubscriptionTransactions: mockStore.owned ? [{ productIdentifier: 'pro_unlock', transactionIdentifier: 't1' }] : [],
    originalAppUserId: '$RCAnonymousID:test',
  };
}

function mockError(code: string, message: string): Error {
  const error = new Error(message) as Error & Record<string, unknown>;
  error.code = code;
  error.userCancelled = code === '1';
  error.readableErrorCode = message;
  error.underlyingErrorMessage = message;
  return error;
}

// Every call to the store: fails until configured, and fails while the store cannot be reached.
async function mockReach(): Promise<void> {
  if (!mockStore.configured) throw new Error('There is no singleton instance. Make sure you configure Purchases before trying to get the default instance.');
  if (!mockStore.reachable) throw mockError('10', 'NETWORK_ERROR');
}

function mockReport(): void {
  const info = mockInfo();
  for (const listener of [...mockStore.listeners]) listener(info);
}

function mockPackage() {
  return {
    identifier: '$rc_lifetime',
    packageType: 'LIFETIME',
    offeringIdentifier: 'pro',
    product: {
      identifier: 'pro_unlock',
      title: 'Pro',
      description: 'Unlock every paid feature',
      price: 4.99,
      priceString: mockStore.priceString,
      currencyCode: 'EUR',
      productCategory: 'NON_SUBSCRIPTION',
      productType: 'NON_CONSUMABLE',
    },
  };
}

async function mockBuy() {
  await mockReach();
  switch (mockStore.outcome) {
    case 'purchased':
      mockStore.owned = true;
      mockStore.earlierPurchase = true;
      mockReport();
      return { customerInfo: mockInfo(), productIdentifier: 'pro_unlock', transaction: { transactionIdentifier: 't1' } };
    case 'cancelled':
      throw mockError('1', 'PURCHASE_CANCELLED');
    case 'pending':
      throw mockError('20', 'PAYMENT_PENDING');
    case 'offline':
      throw mockError('10', 'NETWORK_ERROR');
    default:
      throw mockError('2', 'STORE_PROBLEM');
  }
}

const mockPurchases = {
  configure: jest.fn((options: { apiKey?: string }) => {
    if (!options?.apiKey) throw new Error('Invalid API key');
    mockStore.configured = true;
    mockStore.configuredWith.push(options.apiKey);
  }),
  isConfigured: jest.fn(async () => mockStore.configured),
  setLogLevel: jest.fn(),
  setLogHandler: jest.fn(),
  getCustomerInfo: jest.fn(async () => {
    await mockReach();
    return mockInfo();
  }),
  addCustomerInfoUpdateListener: jest.fn((listener: Listener) => {
    mockStore.listeners.push(listener);
  }),
  removeCustomerInfoUpdateListener: jest.fn((listener: Listener) => {
    mockStore.listeners = mockStore.listeners.filter((l) => l !== listener);
    return true;
  }),
  getOfferings: jest.fn(async () => {
    await mockReach();
    const pkg = mockPackage();
    const offering = (identifier: string) => ({
      identifier,
      serverDescription: 'Pro unlock',
      metadata: {},
      availablePackages: [{ ...pkg, offeringIdentifier: identifier }],
      lifetime: { ...pkg, offeringIdentifier: identifier },
    });
    return { current: offering('default'), all: { default: offering('default'), pro: offering('pro') } };
  }),
  getProducts: jest.fn(async (ids: string[]) => {
    await mockReach();
    return ids.includes('pro_unlock') ? [mockPackage().product] : [];
  }),
  purchasePackage: jest.fn(async (_pkg: unknown) => mockBuy()),
  purchaseStoreProduct: jest.fn(async (_product: unknown) => mockBuy()),
  purchaseProduct: jest.fn(async (_id: unknown) => mockBuy()),
  restorePurchases: jest.fn(async () => {
    await mockReach();
    if (mockStore.earlierPurchase) {
      mockStore.owned = true;
      mockReport();
    }
    return mockInfo();
  }),
  syncPurchases: jest.fn(async () => {
    await mockReach();
  }),
  invalidateCustomerInfoCache: jest.fn(async () => undefined),
};

jest.mock(
  'react-native-purchases',
  () => ({
    __esModule: true,
    default: mockPurchases,
    ...mockPurchases,
    PURCHASES_ERROR_CODE: {
      UNKNOWN_ERROR: '0',
      PURCHASE_CANCELLED_ERROR: '1',
      STORE_PROBLEM_ERROR: '2',
      PURCHASE_NOT_ALLOWED_ERROR: '3',
      PURCHASE_INVALID_ERROR: '4',
      PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR: '5',
      PRODUCT_ALREADY_PURCHASED_ERROR: '6',
      NETWORK_ERROR: '10',
      PAYMENT_PENDING_ERROR: '20',
    },
    LOG_LEVEL: { VERBOSE: 'VERBOSE', DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
    PACKAGE_TYPE: { UNKNOWN: 'UNKNOWN', CUSTOM: 'CUSTOM', LIFETIME: 'LIFETIME', ANNUAL: 'ANNUAL', MONTHLY: 'MONTHLY' },
    PRODUCT_CATEGORY: { NON_SUBSCRIPTION: 'NON_SUBSCRIPTION', SUBSCRIPTION: 'SUBSCRIPTION', UNKNOWN: 'UNKNOWN' },
  }),
  { virtual: true },
);

// The phone's own storage. It outlives restarts.
const mockDevice = {
  asyncStorage: new Map<string, string>(),
  secureStore: new Map<string, string>(),
};

jest.mock(
  '@react-native-async-storage/async-storage',
  () => {
    const store = {
      getItem: async (key: string) => mockDevice.asyncStorage.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        mockDevice.asyncStorage.set(key, String(value));
      },
      removeItem: async (key: string) => {
        mockDevice.asyncStorage.delete(key);
      },
      mergeItem: async (key: string, value: string) => {
        const before = JSON.parse(mockDevice.asyncStorage.get(key) ?? '{}');
        mockDevice.asyncStorage.set(key, JSON.stringify({ ...before, ...JSON.parse(value) }));
      },
      getAllKeys: async () => [...mockDevice.asyncStorage.keys()],
      multiGet: async (keys: string[]) => keys.map((k) => [k, mockDevice.asyncStorage.get(k) ?? null]),
      multiSet: async (pairs: [string, string][]) => {
        for (const [k, v] of pairs) mockDevice.asyncStorage.set(k, String(v));
      },
      multiRemove: async (keys: string[]) => {
        for (const k of keys) mockDevice.asyncStorage.delete(k);
      },
      clear: async () => mockDevice.asyncStorage.clear(),
    };
    return { __esModule: true, default: store, ...store };
  },
  { virtual: true },
);

jest.mock(
  'expo-secure-store',
  () => ({
    isAvailableAsync: async () => true,
    getItemAsync: async (key: string) => mockDevice.secureStore.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      mockDevice.secureStore.set(key, String(value));
    },
    deleteItemAsync: async (key: string) => {
      mockDevice.secureStore.delete(key);
    },
    getItem: (key: string) => mockDevice.secureStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      mockDevice.secureStore.set(key, String(value));
    },
    AFTER_FIRST_UNLOCK: 0,
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    ALWAYS: 2,
    WHEN_UNLOCKED: 5,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  }),
  { virtual: true },
);

// A fresh launch of the app: modules load again and the SDK starts unconfigured; the store and the
// phone's storage stay as they were.
function load(entry: 'index' | 'index.web' = 'index'): PurchasesBlock {
  jest.resetModules();
  mockStore.configured = false;
  mockStore.listeners = [];
  return require(`../src/blocks/purchases/${entry}`) as PurchasesBlock;
}

// Lets the block's pending promises (configure, getCustomerInfo, storage reads) finish.
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

// Asks once so the block starts up, lets it settle, then asks again.
async function unlocked(block: PurchasesBlock, entitlement = 'pro'): Promise<boolean> {
  await block.isUnlocked(entitlement);
  await settle();
  return block.isUnlocked(entitlement);
}

async function locked(block: PurchasesBlock): Promise<string[]> {
  await block.lockedFeatures();
  await settle();
  return [...(await block.lockedFeatures())];
}

function storeCalls(): number {
  return Object.values(mockPurchases).reduce((total, fn) => total + fn.mock.calls.length, 0);
}

function sourceFiles(dir: string): string[] {
  const fs = jest.requireActual('fs') as typeof import('fs');
  const path = jest.requireActual('path') as typeof import('path');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|mjs|cjs|json)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const previousKeys = {
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
};

function setKeys(present: boolean): void {
  if (present) {
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_testKey';
    process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = 'goog_testKey';
  } else {
    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
    delete process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  }
}

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_USE_FAKES;
  setKeys(true);
  jest.clearAllMocks();
  Object.assign(mockStore, {
    reachable: true,
    owned: false,
    earlierPurchase: false,
    outcome: 'purchased',
    priceString: '4,99 €',
    configuredWith: [],
    configured: false,
    listeners: [],
  });
  mockDevice.asyncStorage.clear();
  mockDevice.secureStore.clear();
});

afterAll(() => {
  if (previousKeys.ios === undefined) delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
  else process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = previousKeys.ios;
  if (previousKeys.android === undefined) delete process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  else process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = previousKeys.android;
});

describe('F014 purchases block', () => {
  it('isUnlocked("pro") is false until the store reports the "pro" entitlement, then true without a restart.', async () => {
    const block = load();
    expect(await unlocked(block)).toBe(false);
    expect(mockStore.configuredWith).toEqual(['appl_testKey']);

    // Asking again changes nothing while the store still has no "pro".
    await settle();
    expect(await block.isUnlocked('pro')).toBe(false);

    // The store now reports "pro" (bought on another device, or granted in RevenueCat).
    mockStore.owned = true;
    mockReport();
    await settle();

    // Same launch, no restart.
    expect(await unlocked(block)).toBe(true);
    // Other entitlements stay locked.
    expect(await unlocked(block, 'team')).toBe(false);
  });

  it('The paid feature list is declared once, and lockedFeatures() returns every listed feature while "pro" is missing and none once it is present.', async () => {
    const block = load();
    const features = [...block.paidFeatures];
    expect(features.length).toBeGreaterThan(0);
    expect(features.every((f) => typeof f === 'string' && f.length > 0)).toBe(true);
    expect(new Set(features).size).toBe(features.length);
    expect([...load('index.web').paidFeatures]).toEqual(features);

    // Declared once: each feature name is written in exactly one file of the block.
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const files = sourceFiles(path.join(__dirname, '..', 'src', 'blocks', 'purchases'));
    for (const feature of features) {
      const literal = new RegExp(`(['"\`])${escape(feature)}\\1`);
      const declaredIn = files.filter((file) => literal.test(fs.readFileSync(file, 'utf8')));
      expect({ feature, files: declaredIn.length }).toEqual({ feature, files: 1 });
    }

    const fresh = load();
    expect(await locked(fresh)).toEqual(features);

    mockStore.owned = true;
    mockReport();
    await settle();
    expect(await locked(fresh)).toEqual([]);
  });

  it('price("pro") returns the store\'s localized price text, or null when the store cannot be reached, the EXPO_PUBLIC key is missing, or on web.', async () => {
    expect(await load().price('pro')).toBe('4,99 €');

    mockStore.priceString = '¥800';
    expect(await load().price('pro')).toBe('¥800');

    mockStore.reachable = false;
    expect(await load().price('pro')).toBeNull();
    mockStore.reachable = true;

    setKeys(false);
    expect(await load().price('pro')).toBeNull();
    expect(mockStore.configured).toBe(false);
    setKeys(true);

    jest.clearAllMocks();
    expect(await load('index.web').price('pro')).toBeNull();
    expect(storeCalls()).toBe(0);
  });

  it('buy("pro") resolves "purchased", "cancelled", "pending" or "failed", only "purchased" unlocks, and on web it resolves "failed".', async () => {
    const cases: [Outcome, BuyResult][] = [
      ['cancelled', 'cancelled'],
      ['pending', 'pending'],
      ['failed', 'failed'],
      ['offline', 'failed'],
    ];
    for (const [outcome, expected] of cases) {
      mockStore.outcome = outcome;
      const block = load();
      expect({ outcome, result: await block.buy('pro') }).toEqual({ outcome, result: expected });
      await settle();
      expect({ outcome, unlocked: await unlocked(block) }).toEqual({ outcome, unlocked: false });
      expect(await locked(block)).toEqual([...block.paidFeatures]);
    }

    // The store cannot be reached at all: no offerings, no purchase.
    mockStore.reachable = false;
    mockStore.outcome = 'purchased';
    const offline = load();
    expect(await offline.buy('pro')).toBe('failed');
    expect(await unlocked(offline)).toBe(false);
    mockStore.reachable = true;

    // Nothing failed or pending was kept: a restart without the store is still locked.
    mockStore.reachable = false;
    expect(await unlocked(load())).toBe(false);
    mockStore.reachable = true;

    // Web never reaches the store, even with the store able to sell.
    jest.clearAllMocks();
    const web = load('index.web');
    expect(await web.buy('pro')).toBe('failed');
    expect(storeCalls()).toBe(0);

    mockStore.outcome = 'purchased';
    const block = load();
    expect(await unlocked(block)).toBe(false);
    expect(await block.buy('pro')).toBe('purchased');
    await settle();
    expect(await unlocked(block)).toBe(true);
    expect(await locked(block)).toEqual([]);
  });

  it('restore() unlocks "pro" when the store reports an earlier purchase and resolves "nothing-to-restore" otherwise.', async () => {
    const nothing = load();
    expect(await unlocked(nothing)).toBe(false);
    expect(await nothing.restore()).toBe('nothing-to-restore');
    await settle();
    expect(await unlocked(nothing)).toBe(false);
    expect(mockPurchases.restorePurchases).toHaveBeenCalled();

    // Bought before on this store account (a new phone, say): the customer record does not show it
    // until a restore finds it.
    mockStore.earlierPurchase = true;
    const block = load();
    expect(await unlocked(block)).toBe(false);
    const result = await block.restore();
    expect(result).not.toBe('nothing-to-restore');
    expect(result).not.toBe('failed');
    await settle();
    expect(await unlocked(block)).toBe(true);
    expect(await locked(block)).toEqual([]);
  });

  it('After an unlock, isUnlocked("pro") stays true after a restart while the store cannot be reached.', async () => {
    // Never unlocked: a restart without the store stays locked.
    mockStore.reachable = false;
    expect(await unlocked(load())).toBe(false);
    mockStore.reachable = true;

    const block = load();
    expect(await block.buy('pro')).toBe('purchased');
    await settle();
    expect(await unlocked(block)).toBe(true);

    // The store goes away, and the app starts again, twice.
    mockStore.reachable = false;
    const restarted = load();
    expect(await unlocked(restarted)).toBe(true);
    expect(await locked(restarted)).toEqual([]);
    expect(await restarted.price('pro')).toBeNull();

    expect(await unlocked(load())).toBe(true);

    // Unlocked through the store's report rather than a purchase: kept the same way.
    mockDevice.asyncStorage.clear();
    mockDevice.secureStore.clear();
    mockStore.reachable = true;
    const reported = load();
    expect(await unlocked(reported)).toBe(true);
    mockStore.reachable = false;
    expect(await unlocked(load())).toBe(true);
  });
});
