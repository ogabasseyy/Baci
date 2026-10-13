const storage = new Map<string, string>();

beforeEach(() => {
  jest.resetModules();
  storage.clear();
  jest.doMock('@react-native-async-storage/async-storage', () => ({
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.set(key, value);
    },
  }));
  jest.doMock('@/lib/query-client', () => ({
    QUERY_CACHE_STORAGE_KEY: 'REACT_QUERY_OFFLINE_CACHE',
  }));
  jest.doMock('expo-crypto', () => ({
    randomUUID: () => require('node:crypto').randomUUID(),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) =>
      require('node:crypto').createHash('sha256').update(value).digest('hex'),
  }));
});

it('retains an existing checkout identity through cache clearing and a restart', async () => {
  // Seed the on-device storage contract, independent of today's exported name.
  // Changing that name without migration must not discard pending purchases.
  const persistedKey = 'checkout-installation-id-v1';
  const installation = '46ed63d7-5f10-49f0-9456-9ff571bec43f';
  storage.set(persistedKey, installation);
  storage.set('cache:products', 'cached products');
  const payload = {
    merchant_id: 'merchant-one',
    customer_email: 'buyer@example.com',
  };
  const { getCheckoutAttemptKey } =
    require('../lib/checkout-attempt-key') as typeof import('../lib/checkout-attempt-key');
  const first = await getCheckoutAttemptKey(payload, 'cart-one');
  const { getClearableCacheStorageKeys } =
    require('../components/settings/clear-cache-keys') as typeof import('../components/settings/clear-cache-keys');
  for (const key of getClearableCacheStorageKeys(storage.keys()))
    storage.delete(key);
  expect(storage.has('cache:products')).toBe(false);
  expect(storage.get(persistedKey)).toBe(installation);
  jest.resetModules();
  const reloaded =
    require('../lib/checkout-attempt-key') as typeof import('../lib/checkout-attempt-key');
  expect(await reloaded.getCheckoutAttemptKey(payload, 'cart-one')).toBe(first);
});
