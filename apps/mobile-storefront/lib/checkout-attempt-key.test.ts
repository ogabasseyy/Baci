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

it('resumes an identical checkout after a process restart without storing customer data', async () => {
  const first = await loadKeyGenerator().getCheckoutAttemptKey(
    payload,
    'cart-one'
  );
  jest.resetModules();
  expect(
    await loadKeyGenerator().getCheckoutAttemptKey(payload, 'cart-one')
  ).toBe(first);
  expect(JSON.stringify([...storage])).not.toContain('buyer@example.com');
  expect(first).toMatch(/^[a-f0-9]{64}$/);
});

it('uses one durable identity for concurrent checkout calls', async () => {
  const { getCheckoutAttemptKey } = loadKeyGenerator();
  const [first, second] = await Promise.all([
    getCheckoutAttemptKey(payload, 'cart-one'),
    getCheckoutAttemptKey(payload, 'cart-one'),
  ]);
  expect(first).toBe(second);
  expect(setItem).toHaveBeenCalledTimes(1);
});

it('allows an intentional identical purchase in a new cart lifecycle', async () => {
  const { getCheckoutAttemptKey } = loadKeyGenerator();
  const first = await getCheckoutAttemptKey(payload, 'cart-one');
  expect(await getCheckoutAttemptKey(payload, 'cart-two')).not.toBe(first);
});

it.each([
  { merchant_id: 'merchant-two' },
  { user_id: 'customer-two' },
  { customer_email: 'guest-two@example.com' },
  { shipping_fee: 8000 },
  { discount_code: 'SALE' },
  { wallet_amount: 1000, use_wallet_credit: true },
  { savings_amount: 1000, savings_goal_id: 'goal', use_savings_credit: true },
  { items: [{ product_id: 'buds3', price: 85000, quantity: 1 }] },
  { items: [{ product_id: 'buds2', price: 85000, quantity: 2 }] },
  { shipping_address: { address: 'Different address' } },
])('does not reuse a key for a changed identity or request: %j', async (change) => {
  const { getCheckoutAttemptKey } = loadKeyGenerator();
  const first = await getCheckoutAttemptKey(payload, 'cart-one');
  expect(
    await getCheckoutAttemptKey({ ...payload, ...change }, 'cart-one')
  ).not.toBe(first);
});

it('ignores object-property order and omitted optional fields', async () => {
  const { getCheckoutAttemptKey } = loadKeyGenerator();
  const first = await getCheckoutAttemptKey(payload, 'cart-one');
  const reordered = Object.fromEntries(Object.entries(payload).reverse());
  expect(
    await getCheckoutAttemptKey({ ...reordered, unused: undefined }, 'cart-one')
  ).toBe(first);
});

it('fails closed on read failures instead of replacing an unknown prior identity', async () => {
  getItem.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(
    loadKeyGenerator().getCheckoutAttemptKey(payload, 'cart-one')
  ).rejects.toThrow('storage unavailable');
  expect(setItem).not.toHaveBeenCalled();
});

it('does not return a key until it is durable and permits retry after a failed write', async () => {
  setItem.mockRejectedValueOnce(new Error('disk full'));
  const { getCheckoutAttemptKey } = loadKeyGenerator();
  await expect(getCheckoutAttemptKey(payload, 'cart-one')).rejects.toThrow(
    'disk full'
  );
  const key = await getCheckoutAttemptKey(payload, 'cart-one');
  jest.resetModules();
  expect(
    await loadKeyGenerator().getCheckoutAttemptKey(payload, 'cart-one')
  ).toBe(key);
});

it('does not silently replace a corrupt persisted identity', async () => {
  storage.set('checkout-installation-id-v1', 'broken');
  await expect(
    loadKeyGenerator().getCheckoutAttemptKey(payload, 'cart-one')
  ).rejects.toThrow('Checkout recovery data is invalid');
  expect(setItem).not.toHaveBeenCalled();
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
