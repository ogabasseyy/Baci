const storage = new Map<string, string>();
const getItem = jest.fn(async (key: string) => storage.get(key) ?? null);
const setItem = jest.fn(async (key: string, value: string) => {
  storage.set(key, value);
});

function loadKeyGenerator() {
  return require('./checkout-attempt-key') as typeof import('./checkout-attempt-key');
}

const payload = {
  merchant_id: 'merchant-one',
  user_id: 'customer-one',
  customer_email: 'buyer@example.com',
  payment_method: 'paystack',
  items: [{ product_id: 'buds2', price: 85000, quantity: 1 }],
  shipping_fee: 7692,
};

beforeEach(() => {
  jest.resetModules();
  storage.clear();
  getItem.mockClear();
  setItem.mockClear();
  jest.doMock('@react-native-async-storage/async-storage', () => ({
    getItem,
    setItem,
  }));
  jest.doMock('expo-crypto', () => ({
    randomUUID: () => require('node:crypto').randomUUID(),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) =>
      require('node:crypto').createHash('sha256').update(value).digest('hex'),
  }));
});

it('resumes the same pending order after a lost response and a lower store-credit balance', async () => {
  const { getCheckoutAttemptKey } = loadKeyGenerator();
  const credited = {
    ...payload,
    use_wallet_credit: true,
    wallet_amount: 5000,
  };
  const first = await getCheckoutAttemptKey(credited, 'cart-one');
  jest.resetModules();
  expect(
    await loadKeyGenerator().getCheckoutAttemptKey(
      { ...credited, wallet_amount: 1000 },
      'cart-one'
    )
  ).toBe(first);
});

it('looks up the sort marker under the base generation for gateway partitions', async () => {
  const usesCodepoint = jest.fn(async () => false);
  jest.doMock('./checkout-idempotency-item-sort', () => ({
    usesCodepointCheckoutItemSort: usesCodepoint,
  }));
  const { getCheckoutAttemptKey } = loadKeyGenerator();
  await getCheckoutAttemptKey(payload, 'cart-one:uba_redvault', {
    frozen: true,
  });
  expect(usesCodepoint).toHaveBeenCalledWith('cart-one');
});

it('stores gateway-partition credit snapshots under the base generation', async () => {
  const { getCheckoutAttemptKey } = loadKeyGenerator();
  await getCheckoutAttemptKey(
    { ...payload, use_wallet_credit: true, wallet_amount: 5000 },
    'cart-one:uba_redvault',
    { frozen: true }
  );
  expect(
    JSON.parse(
      storage.get('checkout-attempt-credit-v1:cart-one') ?? '{}'
    ) as Record<string, unknown>
  ).toEqual({ use_wallet_credit: true, wallet_amount: 5000 });
  expect(
    storage.get('checkout-attempt-credit-v1:cart-one:uba_redvault')
  ).toBeUndefined();
});

it('resumes the same pending order when changing payment gateways', async () => {
  const { getCheckoutAttemptKey } = loadKeyGenerator();
  const first = await getCheckoutAttemptKey(payload, 'cart-one');
  expect(
    await getCheckoutAttemptKey(
      { ...payload, payment_method: 'korapay', payment_status: 'pending' },
      'cart-one'
    )
  ).toBe(first);
});
