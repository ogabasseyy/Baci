import { CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY } from '@/config/checkout-storage';
import { applyCheckoutCreditSnapshot } from './checkout-attempt-credit-snapshot';

const storage = new Map<string, string>();
const mockGetItem = jest.fn(async (key: string) => storage.get(key) ?? null);
const mockSetItem = jest.fn(async (key: string, value: string) => {
  storage.set(key, value);
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
}));

const generation = '46ed63d7-5f10-49f0-9456-9ff571bec43f';

beforeEach(() => {
  storage.clear();
  mockGetItem.mockClear();
  mockSetItem.mockClear();
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
  expect(storage.get(CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY)).toContain('5000');
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
