import { CHECKOUT_GENERATION_STORAGE_KEY } from '@/config/checkout-storage';
import { clearPersistedCheckoutGeneration } from './clear-persisted-checkout-generation';
import { persistCheckoutGeneration } from './persist-checkout-generation';
import { readPersistedCheckoutGeneration } from './read-persisted-checkout-generation';

const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (key: string) => mockStorage.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    mockStorage.set(key, value);
  },
  removeItem: async (key: string) => {
    mockStorage.delete(key);
  },
}));

const generation = '46ed63d7-5f10-49f0-9456-9ff571bec43f';

beforeEach(() => {
  mockStorage.clear();
});

it('removes the dedicated generation so cart persistence can keep the empty-cart identity', async () => {
  await persistCheckoutGeneration(generation);
  expect(mockStorage.get(CHECKOUT_GENERATION_STORAGE_KEY)).toBe(generation);
  await clearPersistedCheckoutGeneration();
  await expect(readPersistedCheckoutGeneration()).resolves.toBeNull();
});
