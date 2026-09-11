import { persistCheckoutGeneration } from './persist-checkout-generation';
import { readPersistedCheckoutGeneration } from './read-persisted-checkout-generation';
import { resolveCheckoutGeneration } from './resolve-checkout-generation';

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
const queuedGeneration = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

beforeEach(() => {
  storage.clear();
  mockGetItem.mockClear();
  mockSetItem.mockClear();
});

describe('bugfix: recover durable generations without clobbering frozen retries', () => {
  it('recovers the awaited generation when cart storage still has a stale UUID', async () => {
    await persistCheckoutGeneration(generation);
    await expect(resolveCheckoutGeneration(queuedGeneration)).resolves.toBe(
      generation
    );
    await expect(readPersistedCheckoutGeneration()).resolves.toBe(generation);
  });

  it('recovers the awaited generation when cart storage still has the default', async () => {
    await persistCheckoutGeneration(generation);
    await expect(resolveCheckoutGeneration('legacy')).resolves.toBe(generation);
  });

  it('keeps a frozen queued generation after the live cart has moved on', async () => {
    await persistCheckoutGeneration(generation);
    await expect(
      resolveCheckoutGeneration(queuedGeneration, { frozen: true })
    ).resolves.toBe(queuedGeneration);
    await expect(readPersistedCheckoutGeneration()).resolves.toBe(generation);
  });
});
