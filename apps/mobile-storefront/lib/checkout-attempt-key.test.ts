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
  expect(
    setItem.mock.calls.filter(([key]) => key === 'checkout-installation-id-v1')
  ).toHaveLength(1);
});

it('recovers the awaited generation after a restart with stale cart storage', async () => {
  const first = await loadKeyGenerator().getCheckoutAttemptKey(
    payload,
    'cart-one'
  );
  jest.resetModules();
  expect(
    await loadKeyGenerator().getCheckoutAttemptKey(
      payload,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    )
  ).toBe(first);
});

it('uses a frozen queued generation after the live cart has moved on', async () => {
  const { getCheckoutAttemptKey } = loadKeyGenerator();
  const first = await getCheckoutAttemptKey(payload, 'cart-one');
  const { persistCheckoutGeneration } =
    require('./persist-checkout-generation') as typeof import('./persist-checkout-generation');
  await persistCheckoutGeneration('cart-two');
  expect(
    await getCheckoutAttemptKey(payload, 'cart-one', { frozen: true })
  ).toBe(first);
  const { readPersistedCheckoutGeneration } =
    require('./read-persisted-checkout-generation') as typeof import('./read-persisted-checkout-generation');
  await expect(readPersistedCheckoutGeneration()).resolves.toBe('cart-two');
});

it('does not persist a frozen snapshot once the live cart has moved on', async () => {
  const { getCheckoutAttemptKey } = loadKeyGenerator();
  const first = await getCheckoutAttemptKey(payload, 'cart-one');
  await getCheckoutAttemptKey(payload, 'cart-two', {
    frozen: true,
    persistFrozen: true,
    liveGeneration: 'cart-one',
  });
  jest.resetModules();
  expect(
    await loadKeyGenerator().getCheckoutAttemptKey(payload, 'stale-cart')
  ).toBe(first);
});

it('persists an active frozen generation before returning a key', async () => {
  const { getCheckoutAttemptKey } = loadKeyGenerator();
  await getCheckoutAttemptKey(payload, 'cart-one');
  const second = await getCheckoutAttemptKey(payload, 'cart-two', {
    frozen: true,
    persistFrozen: true,
  });
  jest.resetModules();
  expect(
    await loadKeyGenerator().getCheckoutAttemptKey(payload, 'stale-cart')
  ).toBe(second);
});

it('resumes the same pending order when email casing or notes change', async () => {
  const { getCheckoutAttemptKey } = loadKeyGenerator();
  const withAddress = {
    ...payload,
    shipping_address: {
      address: '15 Marina Road',
      city: 'Lagos',
      notes: 'leave at the gate',
      state: 'Lagos',
    },
  };
  const first = await getCheckoutAttemptKey(withAddress, 'cart-one');
  expect(
    await getCheckoutAttemptKey(
      {
        ...withAddress,
        customer_email: 'Buyer@Example.com',
        shipping_address: {
          ...withAddress.shipping_address,
          notes: '  leave  at  the  gate  ',
        },
      },
      'cart-one'
    )
  ).toBe(first);
});

it('allows an intentional identical purchase in a new cart lifecycle', async () => {
  const { getCheckoutAttemptKey } = loadKeyGenerator();
  const first = await getCheckoutAttemptKey(payload, 'cart-one');
  const { persistCheckoutGeneration } =
    require('./persist-checkout-generation') as typeof import('./persist-checkout-generation');
  await persistCheckoutGeneration('cart-two');
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

it('does not return a key until the generation write succeeds', async () => {
  storage.set(
    'checkout-installation-id-v1',
    '46ed63d7-5f10-49f0-9456-9ff571bec43f'
  );
  setItem.mockRejectedValueOnce(new Error('disk full'));
  const { getCheckoutAttemptKey } = loadKeyGenerator();
  await expect(getCheckoutAttemptKey(payload, 'cart-one')).rejects.toThrow(
    'disk full'
  );
});

it('does not return a key until an active frozen generation write succeeds', async () => {
  storage.set(
    'checkout-installation-id-v1',
    '46ed63d7-5f10-49f0-9456-9ff571bec43f'
  );
  setItem.mockRejectedValueOnce(new Error('disk full'));
  const { getCheckoutAttemptKey } = loadKeyGenerator();
  await expect(
    getCheckoutAttemptKey(payload, 'cart-one', {
      frozen: true,
      persistFrozen: true,
    })
  ).rejects.toThrow('disk full');
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

it('resumes the same pending order when cart line order changes', async () => {
  const { getCheckoutAttemptKey } = loadKeyGenerator();
  const items = [
    { product_id: 'buds2', price: 85000, quantity: 1 },
    { product_id: 'case', price: 5000, quantity: 1 },
  ];
  const first = await getCheckoutAttemptKey({ ...payload, items }, 'cart-one');
  expect(
    await getCheckoutAttemptKey(
      { ...payload, items: [...items].reverse() },
      'cart-one'
    )
  ).toBe(first);
});
