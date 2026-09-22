import { CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY } from '@/config/checkout-storage';
import { markCodepointCheckoutItemSort } from './mark-codepoint-checkout-item-sort';

const storage = new Map<string, string>();
const mockSetItem = jest.fn(async (key: string, value: string) => {
  storage.set(key, value);
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: (key: string, value: string) => mockSetItem(key, value),
}));

const generation = '46ed63d7-5f10-49f0-9456-9ff571bec43f';
const otherGeneration = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

beforeEach(() => {
  storage.clear();
  mockSetItem.mockClear();
});

it('marks one generation without touching another generation marker', async () => {
  await markCodepointCheckoutItemSort(generation);
  expect(
    storage.get(
      `${CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY}:${generation}`
    )
  ).toBe('1');
  expect(
    storage.get(
      `${CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY}:${otherGeneration}`
    )
  ).toBeUndefined();
});
