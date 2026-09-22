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
const otherGeneration = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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
it('freezes the first observed store-credit fields for a checkout generation', async () => {
  const first = await loadSnapshot().applyCheckoutCreditSnapshot(
    {
      wallet_amount: 5000,
      use_wallet_credit: true,
    },
    generation
  );
  expect(first.wallet_amount).toBe(5000);
  const replay = await loadSnapshot().applyCheckoutCreditSnapshot(
    {
      wallet_amount: 1000,
      use_wallet_credit: true,
    },
    generation
  );
  expect(replay.wallet_amount).toBe(5000);
});

it('drops credit fields that were absent from the first snapshot', async () => {
  await loadSnapshot().applyCheckoutCreditSnapshot(
    {
      wallet_amount: 5000,
      use_wallet_credit: true,
    },
    generation
  );
  const replay = await loadSnapshot().applyCheckoutCreditSnapshot(
    {
      wallet_amount: 1000,
      use_wallet_credit: true,
      savings_amount: 2000,
      savings_goal_id: 'goal-1',
      use_savings_credit: true,
    },
    generation
  );
  expect(replay).toEqual({
    wallet_amount: 5000,
    use_wallet_credit: true,
  });
});

it('serializes concurrent applies for the same generation', async () => {
  const gate = gateFirstRead();

  const first = loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 5000 },
    generation
  );
  const second = loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 1000 },
    generation
  );
  await gate.entered;
  gate.release(null);
  const [firstResult, secondResult] = await Promise.all([first, second]);

  expect(firstResult.wallet_amount).toBe(5000);
  expect(secondResult.wallet_amount).toBe(5000);
  expect(
    JSON.parse(storage.get(snapshotKey(generation)) ?? '{}') as {
      wallet_amount?: number;
    }
  ).toEqual({ wallet_amount: 5000 });
});

it('lets other generations proceed while one apply is hung', async () => {
  const gate = gateFirstRead();

  const hung = loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 5000 },
    generation
  );
  await gate.entered;
  const other = await loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 1000 },
    otherGeneration
  );

  expect(other.wallet_amount).toBe(1000);
  expect(
    JSON.parse(storage.get(snapshotKey(otherGeneration)) ?? '{}') as {
      wallet_amount?: number;
    }
  ).toEqual({ wallet_amount: 1000 });
  gate.release(null);
  await hung;
});

it('releases snapshots without waiting for a hung queued apply', async () => {
  const gate = gateFirstRead();

  const hungApply = loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 5000 },
    generation
  );
  await gate.entered;
  await loadSnapshot().releaseCheckoutCreditSnapshot(otherGeneration);
  gate.release(null);
  await hungApply;
});

it('removes only the finalized generation snapshot', async () => {
  await loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 5000 },
    generation
  );
  await loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 1000 },
    otherGeneration
  );
  await loadSnapshot().releaseCheckoutCreditSnapshot(generation);
  expect(storage.get(snapshotKey(generation))).toBeUndefined();
  expect(
    JSON.parse(storage.get(snapshotKey(otherGeneration)) ?? '{}') as {
      wallet_amount?: number;
    }
  ).toEqual({ wallet_amount: 1000 });
});

it('fails closed when a stored generation snapshot is malformed', async () => {
  storage.set(
    snapshotKey(generation),
    JSON.stringify({ wallet_amount: '5000' })
  );
  await expect(
    loadSnapshot().applyCheckoutCreditSnapshot(
      { wallet_amount: 1000 },
      generation
    )
  ).rejects.toThrow('Checkout recovery data is invalid');
});
