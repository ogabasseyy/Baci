import { CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY } from '@/config/checkout-storage';

function loadApply() {
  return require('./checkout-attempt-credit-snapshot') as typeof import('./checkout-attempt-credit-snapshot');
}

function loadRelease() {
  return require('./release-checkout-credit-snapshot') as typeof import('./release-checkout-credit-snapshot');
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
const otherGeneration = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function snapshotKey(id: string): string {
  return `${CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY}:${id}`;
}

beforeEach(() => {
  jest.resetModules();
  storage.clear();
  mockGetItem.mockClear();
  mockSetItem.mockClear();
  mockRemoveItem.mockClear();
});

it('releases snapshots without waiting for a hung queued apply', async () => {
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

  const hungApply = loadApply().applyCheckoutCreditSnapshot(
    { wallet_amount: 5000 },
    generation
  );
  await enteredPromise;
  await loadRelease().releaseCheckoutCreditSnapshot(otherGeneration);
  release(null);
  await hungApply;
});

it('removes only the finalized generation snapshot', async () => {
  await loadApply().applyCheckoutCreditSnapshot(
    { wallet_amount: 5000 },
    generation
  );
  await loadApply().applyCheckoutCreditSnapshot(
    { wallet_amount: 1000 },
    otherGeneration
  );
  await loadRelease().releaseCheckoutCreditSnapshot(generation);
  expect(storage.get(snapshotKey(generation))).toBeUndefined();
  expect(
    JSON.parse(storage.get(snapshotKey(otherGeneration)) ?? '{}') as {
      wallet_amount?: number;
    }
  ).toEqual({ wallet_amount: 1000 });
});

it('lets the next apply freeze fresh fields after a release', async () => {
  await loadApply().applyCheckoutCreditSnapshot(
    { wallet_amount: 5000 },
    generation
  );
  await loadRelease().releaseCheckoutCreditSnapshot(generation);
  const retry = await loadApply().applyCheckoutCreditSnapshot(
    { wallet_amount: 1000 },
    generation
  );
  expect(retry.wallet_amount).toBe(1000);
  expect(
    JSON.parse(storage.get(snapshotKey(generation)) ?? '{}') as {
      wallet_amount?: number;
    }
  ).toEqual({ wallet_amount: 1000 });
});
