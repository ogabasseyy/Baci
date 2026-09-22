import { CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY } from '@/config/checkout-storage';
import { releaseCodepointCheckoutItemSort } from './release-codepoint-checkout-item-sort';

const storage = new Map<string, string>();
const mockRemoveItem = jest.fn(async (key: string) => {
  storage.delete(key);
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  removeItem: (key: string) => mockRemoveItem(key),
}));

const generation = '46ed63d7-5f10-49f0-9456-9ff571bec43f';
const otherGeneration = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

beforeEach(() => {
  storage.clear();
  mockRemoveItem.mockClear();
});

it('releases only the finalized generation marker', async () => {
  storage.set(
    `${CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY}:${generation}`,
    '1'
  );
  storage.set(
    `${CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY}:${otherGeneration}`,
    '1'
  );
  await releaseCodepointCheckoutItemSort(generation);
  expect(
    storage.get(
      `${CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY}:${generation}`
    )
  ).toBeUndefined();
  expect(
    storage.get(
      `${CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY}:${otherGeneration}`
    )
  ).toBe('1');
});
