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
    const { mintedCheckoutGenerations } =
      require('./minted-checkout-generations') as typeof import('./minted-checkout-generations');
    const minted = mintedCheckoutGenerations.register(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    );
    await persistCheckoutGeneration(minted);
    expect(storage.get(`checkout-idempotency-item-sort-v2:${minted}`)).toBe(
      '1'
    );
  });

  it('does not expose a generation when its sort marker write fails', async () => {
    const { mintedCheckoutGenerations } =
      require('./minted-checkout-generations') as typeof import('./minted-checkout-generations');
    const minted = mintedCheckoutGenerations.register(
      '99999999-9999-4999-8999-999999999999'
    );
    mockSetItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(persistCheckoutGeneration(minted)).rejects.toThrow(
      'disk full'
    );
    expect(storage.get('checkout-generation-v1')).toBeUndefined();
  });

  it('does not mark restored legacy generations as code-point sorted', async () => {
    const { mintedCheckoutGenerations } =
      require('./minted-checkout-generations') as typeof import('./minted-checkout-generations');
    const newer = mintedCheckoutGenerations.register(
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    );
    await persistCheckoutGeneration(newer);
    const legacy = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    await persistCheckoutGeneration(legacy);
    expect(storage.get(`checkout-idempotency-item-sort-v2:${newer}`)).toBe('1');
    expect(
      storage.get(`checkout-idempotency-item-sort-v2:${legacy}`)
    ).toBeUndefined();
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

    let restored!: () => void;
    const restoredPromise = new Promise<void>((resolve) => {
      restored = resolve;
    });
    mockSetItem.mockImplementationOnce(async (key: string, value: string) => {
      storage.set(key, value);
      restored();
    });
    releaseOlder();
    await restoredPromise;
    // The abandoned write landed after the newer one, so the newer
    // identity is restored instead of leaving a stale generation behind.
    expect(storage.get('checkout-generation-v1')).toBe(newer);
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

  it('preserves a same-generation retry when the abandoned write lands late', async () => {
    jest.useFakeTimers();
    const same = '55555555-5555-4555-8555-555555555555';
    const newer = '66666666-6666-4666-8666-666666666666';
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
    const hung = persistCheckoutGeneration(same);
    const hungAssertion = expect(hung).rejects.toThrow(
      'Checkout storage write timed out'
    );
    await jest.advanceTimersByTimeAsync(5_000);
    await hungAssertion;

    await persistCheckoutGeneration(same);
    expect(storage.get('checkout-generation-v1')).toBe(same);

    releaseOlder();
    // A later persist both synchronizes the compensation and proves the
    // queue stayed healthy; the vetoed compensation never touches storage.
    await persistCheckoutGeneration(newer);
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

  it('never issues an abandoned write after a newer persist completed', async () => {
    jest.useFakeTimers();
    const blocker = '77777777-7777-4777-8777-777777777777';
    const older = '88888888-8888-4888-8888-888888888888';
    const newer = '99999999-9999-4999-8999-999999999999';
    // Hold the shared queue so the older persist stays queued without
    // starting while the timeout detaches the chain.
    let releaseBlocker!: () => void;
    let blockerEntered!: () => void;
    const blockerEnteredPromise = new Promise<void>((resolve) => {
      blockerEntered = resolve;
    });
    mockSetItem.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          blockerEntered();
          releaseBlocker = () => resolve();
        })
    );
    const blockerWrite = persistCheckoutGeneration(blocker);
    void blockerWrite.catch(() => undefined);
    await blockerEnteredPromise;
    const hung = persistCheckoutGeneration(older);
    const hungAssertion = expect(hung).rejects.toThrow(
      'Checkout storage write timed out'
    );
    await jest.advanceTimersByTimeAsync(5_000);
    await hungAssertion;

    // A newer persist completes on the fresh chain while the older one
    // never started.
    await persistCheckoutGeneration(newer);
    expect(storage.get('checkout-generation-v1')).toBe(newer);
    const writesBeforeRelease = mockSetItem.mock.calls.length;

    // The abandoned chain drains: the blocker lands, then the older
    // attempt starts, sees the newer completion, and stands down without
    // issuing its write — the stale value is never durably observable,
    // so no kill window needs the detached compensation.
    releaseBlocker();
    for (let tick = 0; tick < 10; tick += 1) {
      await Promise.resolve();
    }
    expect(storage.get('checkout-generation-v1')).toBe(newer);
    expect(
      mockSetItem.mock.calls
        .slice(writesBeforeRelease)
        .filter(([key]) => key === 'checkout-generation-v1')
        .map(([, value]) => value)
    ).not.toContain(older);
    expect(mockRemoveItem).not.toHaveBeenCalled();
  });
});
