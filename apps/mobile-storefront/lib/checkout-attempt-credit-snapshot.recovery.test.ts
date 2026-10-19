import { CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY } from '@/config/checkout-storage';

function loadSnapshot() {
  return require('./checkout-attempt-credit-snapshot') as typeof import('./checkout-attempt-credit-snapshot');
}

const storage = new Map<string, string>();
const mockGetItem = jest.fn(async (key: string) => storage.get(key) ?? null);
const mockSetItem = jest.fn(async (key: string, value: string) => {
  storage.set(key, value);
});
const mockRemoveItem = jest.fn(async (key: string) => {
  storage.delete(key);
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
  removeItem: (key: string) => mockRemoveItem(key),
}));

const generation = '46ed63d7-5f10-49f0-9456-9ff571bec43f';

function snapshotKey(id: string): string {
  return `${CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY}:${id}`;
}

function gateFirstRead() {
  let release!: (value: string | null) => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve;
  });
  mockGetItem.mockImplementationOnce(
    () =>
      new Promise<string | null>((resolve) => {
        release = resolve;
        entered();
      })
  );
  return {
    entered: enteredPromise,
    release: (value: string | null) => release(value),
  };
}

beforeEach(() => {
  jest.resetModules();
  storage.clear();
  mockGetItem.mockClear();
  mockSetItem.mockClear();
  mockRemoveItem.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});
it('fails a checkout attempt when the snapshot read never settles', async () => {
  jest.useFakeTimers();
  mockGetItem.mockImplementationOnce(
    () => new Promise<string | null>(() => undefined)
  );
  const pending = loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 5000 },
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  );
  const assertion = expect(pending).rejects.toThrow(
    'Checkout storage read timed out'
  );
  await jest.advanceTimersByTimeAsync(5_000);
  await assertion;
});

it('resets the queue after a snapshot timeout so the same-generation retry proceeds', async () => {
  jest.useFakeTimers();
  mockGetItem.mockImplementationOnce(
    () => new Promise<string | null>(() => undefined)
  );
  const pending = loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 5000 },
    generation
  );
  const assertion = expect(pending).rejects.toThrow(
    'Checkout storage read timed out'
  );
  await jest.advanceTimersByTimeAsync(5_000);
  await assertion;
  const retry = await loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 5000 },
    generation
  );
  expect(retry.wallet_amount).toBe(5000);
  expect(
    JSON.parse(storage.get(snapshotKey(generation)) ?? '{}') as {
      wallet_amount?: number;
    }
  ).toEqual({ wallet_amount: 5000 });
});

it('adopts the newer choice when an abandoned read settles after a retry', async () => {
  jest.useFakeTimers();
  const gate = gateFirstRead();
  const first = loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 1000 },
    generation
  );
  await gate.entered;
  const firstAssertion = expect(first).rejects.toThrow(
    'Checkout storage read timed out'
  );
  await jest.advanceTimersByTimeAsync(5_000);
  await firstAssertion;

  const retry = await loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 5000 },
    generation
  );
  expect(retry.wallet_amount).toBe(5000);

  gate.release(null);
  await jest.advanceTimersByTimeAsync(0);
  // The abandoned read adopts the newer choice instead of freezing its
  // own, so the only snapshot write is the retry's.
  expect(mockSetItem).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(storage.get(snapshotKey(generation)) ?? '{}') as {
      wallet_amount?: number;
    }
  ).toEqual({ wallet_amount: 5000 });
});

it('keeps other generations serialized when one generation queue resets', async () => {
  jest.useFakeTimers();
  const otherGeneration = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  mockGetItem.mockImplementationOnce(
    () => new Promise<string | null>(() => undefined)
  );
  const hungA = loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 1000 },
    generation
  );
  const hungAssertion = expect(hungA).rejects.toThrow(
    'Checkout storage read timed out'
  );
  await jest.advanceTimersByTimeAsync(4_999);

  const gate = gateFirstRead();
  const firstB = loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 5000 },
    otherGeneration
  );
  await gate.entered;
  await jest.advanceTimersByTimeAsync(1);
  await hungAssertion;

  let secondBRan = false;
  const secondB = loadSnapshot()
    .applyCheckoutCreditSnapshot({ wallet_amount: 1000 }, otherGeneration)
    .then((result) => {
      secondBRan = true;
      return result;
    });
  await jest.advanceTimersByTimeAsync(0);
  expect(secondBRan).toBe(false);

  gate.release(null);
  const [firstResult, secondResult] = await Promise.all([firstB, secondB]);
  expect(firstResult.wallet_amount).toBe(5000);
  expect(secondResult.wallet_amount).toBe(5000);
  expect(
    JSON.parse(storage.get(snapshotKey(otherGeneration)) ?? '{}') as {
      wallet_amount?: number;
    }
  ).toEqual({ wallet_amount: 5000 });
});
