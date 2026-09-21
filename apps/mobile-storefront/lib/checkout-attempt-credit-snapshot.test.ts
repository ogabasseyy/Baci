import { CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY } from '@/config/checkout-storage';
import {
  applyCheckoutCreditSnapshot,
  releaseCheckoutCreditSnapshot,
} from './checkout-attempt-credit-snapshot';

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

beforeEach(() => {
  storage.clear();
  mockGetItem.mockClear();
  mockSetItem.mockClear();
  mockRemoveItem.mockClear();
});

it('freezes the first observed store-credit fields for a checkout generation', async () => {
  const first = await applyCheckoutCreditSnapshot(
    {
      wallet_amount: 5000,
      use_wallet_credit: true,
    },
    generation
  );
  expect(first.wallet_amount).toBe(5000);
  const replay = await applyCheckoutCreditSnapshot(
    {
      wallet_amount: 1000,
      use_wallet_credit: true,
    },
    generation
  );
  expect(replay.wallet_amount).toBe(5000);
});

it('drops credit fields that were absent from the first snapshot', async () => {
  await applyCheckoutCreditSnapshot(
    {
      wallet_amount: 5000,
      use_wallet_credit: true,
    },
    generation
  );
  const replay = await applyCheckoutCreditSnapshot(
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

it('serializes concurrent writes for different generations', async () => {
  let releaseFirst!: (value: string | null) => void;
  mockGetItem.mockImplementationOnce(
    () =>
      new Promise<string | null>((resolve) => {
        releaseFirst = resolve;
      })
  );

  const first = applyCheckoutCreditSnapshot(
    { wallet_amount: 5000 },
    generation
  );
  const second = applyCheckoutCreditSnapshot(
    { wallet_amount: 1000 },
    otherGeneration
  );
  // Let the first queued operation reach its gated storage read.
  await new Promise((resolve) => setTimeout(resolve, 0));
  releaseFirst(null);
  await Promise.all([first, second]);

  const persisted = JSON.parse(
    storage.get(CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY) ?? '{}'
  ) as Record<string, { wallet_amount?: number }>;
  expect(persisted[generation]?.wallet_amount).toBe(5000);
  expect(persisted[otherGeneration]?.wallet_amount).toBe(1000);
});

it('releases snapshots without waiting for a hung queued apply', async () => {
  let releaseHung!: (value: string | null) => void;
  mockGetItem.mockImplementationOnce(
    () =>
      new Promise<string | null>((resolve) => {
        releaseHung = resolve;
      })
  );
  const hungApply = applyCheckoutCreditSnapshot(
    { wallet_amount: 5000 },
    generation
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  await releaseCheckoutCreditSnapshot(otherGeneration);
  releaseHung(null);
  await hungApply;
});

it('removes a finalized generation from the credit map', async () => {
  await applyCheckoutCreditSnapshot({ wallet_amount: 5000 }, generation);
  await applyCheckoutCreditSnapshot({ wallet_amount: 1000 }, otherGeneration);
  await releaseCheckoutCreditSnapshot(generation);
  const persisted = JSON.parse(
    storage.get(CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY) ?? '{}'
  ) as Record<string, unknown>;
  expect(persisted).not.toHaveProperty(generation);
  expect(persisted).toHaveProperty(otherGeneration);
});

it('fails closed when a stored generation snapshot is malformed', async () => {
  storage.set(
    CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY,
    JSON.stringify({ [generation]: { wallet_amount: '5000' } })
  );
  await expect(
    applyCheckoutCreditSnapshot({ wallet_amount: 1000 }, generation)
  ).rejects.toThrow('Checkout recovery data is invalid');
});
