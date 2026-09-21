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

afterEach(() => {
  jest.useRealTimers();
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
    let olderEntered!: () => void;
    const olderAtGate = new Promise<void>((resolve) => {
      olderEntered = resolve;
    });
    mockSetItem.mockImplementationOnce(
      (key: string, value: string) =>
        new Promise<void>((resolve) => {
          finishOlder = () => {
            storage.set(key, value);
            resolve();
          };
          olderEntered();
        })
    );
    const olderWrite = persistCheckoutGeneration(generation);
    const newerWrite = persistCheckoutGeneration(newer);
    await olderAtGate;
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

  it('does not expose a generation when its sort marker write fails', async () => {
    const { registerMintedCheckoutGeneration } =
      require('./minted-checkout-generations') as typeof import('./minted-checkout-generations');
    const minted = registerMintedCheckoutGeneration(
      '99999999-9999-4999-8999-999999999999'
    );
    mockSetItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(persistCheckoutGeneration(minted)).rejects.toThrow(
      'disk full'
    );
    expect(storage.get('checkout-generation-v1')).toBeUndefined();
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

  it('resets the queue after a hung write so later persists proceed', async () => {
    jest.useFakeTimers();
    const older = '11111111-1111-4111-8111-111111111111';
    const newer = '22222222-2222-4222-8222-222222222222';
    let releaseOlder!: () => void;
    mockSetItem.mockImplementationOnce(
      (key: string, value: string) =>
        new Promise<void>((resolve) => {
          releaseOlder = () => {
            storage.set(key, value);
            resolve();
          };
        })
    );
    const hung = persistCheckoutGeneration(older);
    const hungAssertion = expect(hung).rejects.toThrow(
      'Checkout storage write timed out'
    );
    await jest.advanceTimersByTimeAsync(5_000);
    await hungAssertion;

    await persistCheckoutGeneration(newer);
    expect(storage.get('checkout-generation-v1')).toBe(newer);

    let compensated!: () => void;
    const compensatedPromise = new Promise<void>((resolve) => {
      compensated = resolve;
    });
    mockRemoveItem.mockImplementationOnce(async (key: string) => {
      storage.delete(key);
      compensated();
    });
    releaseOlder();
    await compensatedPromise;
    // The abandoned write landed after the newer one, so it is removed
    // instead of restoring a stale generation.
    expect(storage.get('checkout-generation-v1')).toBeUndefined();
  });

  it('preserves a newer generation when invalidating an abandoned write', async () => {
    jest.useFakeTimers();
    const older = '33333333-3333-4333-8333-333333333333';
    const newer = '44444444-4444-4444-8444-444444444444';
    let releaseOlder!: () => void;
    mockSetItem.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseOlder = () => {
            storage.set('checkout-generation-v1', older);
            // Simulate a newer persist landing before the compensation
            // read runs.
            storage.set('checkout-generation-v1', newer);
            resolve();
          };
        })
    );
    const hung = persistCheckoutGeneration(older);
    const hungAssertion = expect(hung).rejects.toThrow(
      'Checkout storage write timed out'
    );
    await jest.advanceTimersByTimeAsync(5_000);
    await hungAssertion;
    let compensationRead!: () => void;
    const compensationReadPromise = new Promise<void>((resolve) => {
      compensationRead = resolve;
    });
    mockGetItem.mockImplementationOnce(async (key: string) => {
      const value = storage.get(key) ?? null;
      compensationRead();
      return value;
    });
    releaseOlder();
    await compensationReadPromise;
    // One flush lets the skip decision run after its storage read settles.
    await Promise.resolve();
    expect(mockGetItem).toHaveBeenCalledWith('checkout-generation-v1');
    expect(storage.get('checkout-generation-v1')).toBe(newer);
    expect(mockRemoveItem).not.toHaveBeenCalled();
  });

  it('swallows detached persist failures so first-item adds can finish', async () => {
    let writeAttempted!: () => void;
    const writeEntered = new Promise<void>((resolve) => {
      writeAttempted = resolve;
    });
    mockSetItem.mockImplementationOnce(async () => {
      writeAttempted();
      throw new Error('disk full');
    });
    persistCheckoutGenerationDetached(generation);
    await writeEntered;
    expect(mockSetItem).toHaveBeenCalled();
  });
});
