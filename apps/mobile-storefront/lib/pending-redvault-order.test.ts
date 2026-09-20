const storage = new Map<string, string>();

beforeEach(() => {
  jest.resetModules();
  storage.clear();
  jest.doMock('@react-native-async-storage/async-storage', () => ({
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: async (key: string) => {
      storage.delete(key);
    },
  }));
});

const KEY = 'checkout-pending-redvault-order-v1';

async function load() {
  return (await import(
    './pending-redvault-order'
  )) as typeof import('./pending-redvault-order');
}

function seed(record: unknown) {
  storage.set(KEY, JSON.stringify(record));
}

describe('resolvePersistedRedvaultOrder', () => {
  it('releases checkout when no fence is persisted', async () => {
    const { resolvePersistedRedvaultOrder } = await load();
    const validateOrder = jest.fn();

    const result = await resolvePersistedRedvaultOrder({
      checkoutGeneration: 'gen-one',
      validateOrder,
    });

    expect(result).toEqual({ blocked: false });
    expect(validateOrder).not.toHaveBeenCalled();
  });

  it('blocks while the same-generation order is unresolved', async () => {
    const { resolvePersistedRedvaultOrder } = await load();
    seed({
      orderId: 'order-rv',
      checkoutGeneration: 'gen-one',
      createdAt: new Date().toISOString(),
    });
    const validateOrder = jest.fn(async () => ({
      order: { payment_status: 'unpaid', shipping_status: 'pending' },
    }));

    const result = await resolvePersistedRedvaultOrder({
      checkoutGeneration: 'gen-one',
      validateOrder,
    });

    expect(result).toEqual({ blocked: true, orderId: 'order-rv' });
    expect(validateOrder).toHaveBeenCalledWith('order-rv');
    expect(storage.has(KEY)).toBe(true);
  });

  it('clears and releases once the order is terminal', async () => {
    const { resolvePersistedRedvaultOrder } = await load();
    seed({
      orderId: 'order-rv',
      checkoutGeneration: 'gen-one',
      createdAt: new Date().toISOString(),
    });
    const validateOrder = jest.fn(async () => ({
      order: { payment_status: 'paid', shipping_status: 'processing' },
    }));

    const result = await resolvePersistedRedvaultOrder({
      checkoutGeneration: 'gen-one',
      validateOrder,
    });

    expect(result).toEqual({ blocked: false });
    expect(storage.has(KEY)).toBe(false);
  });

  it('clears and releases once the order is cancelled', async () => {
    const { resolvePersistedRedvaultOrder } = await load();
    seed({
      orderId: 'order-rv',
      checkoutGeneration: 'gen-one',
      createdAt: new Date().toISOString(),
    });
    const validateOrder = jest.fn(async () => ({
      order: { payment_status: 'cancelled', shipping_status: 'cancelled' },
    }));

    const result = await resolvePersistedRedvaultOrder({
      checkoutGeneration: 'gen-one',
      validateOrder,
    });

    expect(result).toEqual({ blocked: false });
    expect(storage.has(KEY)).toBe(false);
  });

  it('drops a rotated-generation record without validating', async () => {
    const { resolvePersistedRedvaultOrder } = await load();
    seed({
      orderId: 'order-rv',
      checkoutGeneration: 'gen-old',
      createdAt: new Date().toISOString(),
    });
    const validateOrder = jest.fn();

    const result = await resolvePersistedRedvaultOrder({
      checkoutGeneration: 'gen-new',
      validateOrder,
    });

    expect(result).toEqual({ blocked: false });
    expect(validateOrder).not.toHaveBeenCalled();
    expect(storage.has(KEY)).toBe(false);
  });

  it('treats a corrupt record as no fence', async () => {
    const { resolvePersistedRedvaultOrder } = await load();
    storage.set(KEY, '{not-json');
    const validateOrder = jest.fn();

    const result = await resolvePersistedRedvaultOrder({
      checkoutGeneration: 'gen-one',
      validateOrder,
    });

    expect(result).toEqual({ blocked: false });
    expect(validateOrder).not.toHaveBeenCalled();
  });

  it('fails closed when validation throws', async () => {
    const { resolvePersistedRedvaultOrder } = await load();
    seed({
      orderId: 'order-rv',
      checkoutGeneration: 'gen-one',
      createdAt: new Date().toISOString(),
    });
    const validateOrder = jest.fn(async () => {
      throw new Error('network down');
    });

    await expect(
      resolvePersistedRedvaultOrder({
        checkoutGeneration: 'gen-one',
        validateOrder,
      })
    ).rejects.toThrow('network down');
    expect(storage.has(KEY)).toBe(true);
  });
});

describe('persist/clear round-trip', () => {
  it('persists and clears the fence record', async () => {
    const {
      clearPersistedRedvaultOrder,
      persistPendingRedvaultOrder,
      readPersistedRedvaultOrder,
    } = await load();

    await expect(readPersistedRedvaultOrder()).resolves.toBeNull();
    const record = {
      orderId: 'order-rv',
      checkoutGeneration: 'gen-one',
      createdAt: new Date().toISOString(),
    };
    await persistPendingRedvaultOrder(record);
    await expect(readPersistedRedvaultOrder()).resolves.toEqual(record);
    await clearPersistedRedvaultOrder();
    await expect(readPersistedRedvaultOrder()).resolves.toBeNull();
  });
});
