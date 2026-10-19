import { persistCheckoutGeneration } from './persist-checkout-generation';
import { readPersistedCheckoutGeneration } from './read-persisted-checkout-generation';

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

it('returns null when no generation has been persisted', async () => {
  await expect(readPersistedCheckoutGeneration()).resolves.toBeNull();
});

it('returns the awaited generation after a successful write', async () => {
  await persistCheckoutGeneration(generation);
  await expect(readPersistedCheckoutGeneration()).resolves.toBe(generation);
});
