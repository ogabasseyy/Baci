import { CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY } from '@/config/checkout-storage';

const storage = new Map<string, string>();
const mockGetItem = jest.fn(async (key: string) => storage.get(key) ?? null);
const mockSetItem = jest.fn(async (key: string, value: string) => {
  storage.set(key, value);
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
}));

function loadSort() {
  return require('./checkout-idempotency-item-sort') as typeof import('./checkout-idempotency-item-sort');
}

function loadRegistry() {
  return require('./minted-checkout-generations') as typeof import('./minted-checkout-generations');
}

const generation = '46ed63d7-5f10-49f0-9456-9ff571bec43f';
const legacyGeneration = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

beforeEach(() => {
  jest.resetModules();
  storage.clear();
  mockGetItem.mockClear();
  mockSetItem.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

it('treats freshly minted generations as code-point sorted without storage', async () => {
  const { registerMintedCheckoutGeneration } = loadRegistry();
  registerMintedCheckoutGeneration(generation);
  await expect(
    loadSort().usesCodepointCheckoutItemSort(generation)
  ).resolves.toBe(true);
  expect(mockGetItem).not.toHaveBeenCalled();
});

it('reads the durable marker for generations minted before this build', async () => {
  storage.set(
    CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY,
    JSON.stringify([legacyGeneration])
  );
  const { usesCodepointCheckoutItemSort } = loadSort();
  await expect(usesCodepointCheckoutItemSort(legacyGeneration)).resolves.toBe(
    true
  );
  await expect(
    usesCodepointCheckoutItemSort('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  ).resolves.toBe(false);
});

it('fails closed when the stored marker set is malformed', async () => {
  storage.set(CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY, 'not-json');
  await expect(
    loadSort().usesCodepointCheckoutItemSort(legacyGeneration)
  ).rejects.toThrow('Checkout recovery data is invalid');
});

it('fails closed instead of hanging behind a stuck persist', async () => {
  jest.useFakeTimers();
  const { enqueueCheckoutGenerationStorage } =
    require('./checkout-generation-storage-queue') as typeof import('./checkout-generation-storage-queue');
  enqueueCheckoutGenerationStorage(() => new Promise<never>(() => undefined));
  const pending = loadSort().usesCodepointCheckoutItemSort(legacyGeneration);
  const assertion = expect(pending).rejects.toThrow(
    'Checkout storage read timed out'
  );
  await jest.advanceTimersByTimeAsync(5_000);
  await assertion;
});
