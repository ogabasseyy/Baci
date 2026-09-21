import {
  persistCheckoutGeneration,
  persistCheckoutGenerationDetached,
} from './persist-checkout-generation';

const storage = new Map<string, string>();
const mockGetItem = jest.fn(async (key: string) => storage.get(key) ?? null);
const mockSetItem = jest.fn(async (key: string, value: string) => {
  storage.set(key, value);
});
const mockRemoveItem = jest.fn(async (key: string) => {
  storage.delete(key);
});

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
  removeItem: (key: string) => mockRemoveItem(key),
}));

const generation = '46ed63d7-5f10-49f0-9456-9ff571bec43f';

beforeEach(() => {
  storage.clear();
  mockGetItem.mockClear();
  mockSetItem.mockClear();
  mockRemoveItem.mockClear();
});

describe('bugfix: checkout generation is durable before the order request', () => {
  it('does not return until the generation write succeeds', async () => {
    mockSetItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(persistCheckoutGeneration(generation)).rejects.toThrow(
      'disk full'
    );
    await persistCheckoutGeneration(generation);
    expect(storage.get('checkout-generation-v1')).toBe(generation);
  });

  it('does not let an earlier generation write finish after a newer persist', async () => {
    const newer = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    let finishOlder!: () => void;
    mockSetItem.mockImplementationOnce(
      (key: string, value: string) =>
        new Promise<void>((resolve) => {
          finishOlder = () => {
            storage.set(key, value);
            resolve();
          };
        })
    );
    const olderWrite = persistCheckoutGeneration(generation);
    const newerWrite = persistCheckoutGeneration(newer);
    // Let the older queued write reach its gated storage call.
    await new Promise((resolve) => setTimeout(resolve, 0));
    finishOlder();
    await Promise.all([olderWrite, newerWrite]);
    expect(storage.get('checkout-generation-v1')).toBe(newer);
  });

  it('marks minted generations as code-point sorted when persisting', async () => {
    const { registerMintedCheckoutGeneration } =
      require('./minted-checkout-generations') as typeof import('./minted-checkout-generations');
    const minted = registerMintedCheckoutGeneration(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    );
    await persistCheckoutGeneration(minted);
    expect(storage.get('checkout-idempotency-item-sort-v2')).toContain(minted);
  });

  it('does not mark restored legacy generations as code-point sorted', async () => {
    const { registerMintedCheckoutGeneration } =
      require('./minted-checkout-generations') as typeof import('./minted-checkout-generations');
    const newer = registerMintedCheckoutGeneration(
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    );
    await persistCheckoutGeneration(newer);
    const legacy = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    await persistCheckoutGeneration(legacy);
    const markers = storage.get('checkout-idempotency-item-sort-v2') ?? '[]';
    expect(markers).toContain(newer);
    expect(markers).not.toContain(legacy);
  });

  it('swallows detached persist failures so first-item adds can finish', async () => {
    mockSetItem.mockRejectedValueOnce(new Error('disk full'));
    persistCheckoutGenerationDetached(generation);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockSetItem).toHaveBeenCalled();
  });
});
