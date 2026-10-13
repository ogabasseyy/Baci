import { jest } from '@jest/globals';
import { checkoutGenerationRestoreGate } from '@/lib/checkout-generation-restore-gate';
import { resolveEffectiveCheckoutGeneration } from './resolve-effective-checkout-generation';

const mockResolve = jest.fn<
  (generation: string, options?: unknown) => Promise<string>
>(async (generation: string) => generation);
let mockLiveGeneration = 'live-gen';

jest.mock('@/lib/resolve-checkout-generation', () => ({
  resolveCheckoutGeneration: (generation: string, options?: unknown) =>
    mockResolve(generation, options),
}));
jest.mock('@/stores/cart-store', () => ({
  useCartStore: {
    getState: () => ({ checkoutGeneration: mockLiveGeneration }),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockLiveGeneration = 'live-gen';
});

afterEach(() => {
  jest.useRealTimers();
});

it('prefers the restored durable generation over a stale frozen snapshot', async () => {
  checkoutGenerationRestoreGate.noteRestoredGeneration('restored-gen');
  mockLiveGeneration = 'restored-gen';

  const { attemptKeyOptions, effectiveCheckoutGeneration } =
    await resolveEffectiveCheckoutGeneration({
      checkoutGeneration: 'stale-cart',
      frozenCheckoutGeneration: 'stale-cart',
    });

  expect(mockResolve).toHaveBeenCalledWith(
    'restored-gen',
    expect.objectContaining({ frozen: true, persistFrozen: true })
  );
  expect(attemptKeyOptions).toEqual({
    frozen: true,
    liveGeneration: 'restored-gen',
    persistFrozen: true,
  });
  expect(effectiveCheckoutGeneration).toBe('restored-gen');
});

it('honors the frozen pin when the live cart belongs to a newer purchase', async () => {
  checkoutGenerationRestoreGate.noteRestoredGeneration('restored-gen');
  mockLiveGeneration = 'new-purchase-gen';

  const { effectiveCheckoutGeneration } =
    await resolveEffectiveCheckoutGeneration({
      checkoutGeneration: 'queued-gen',
      frozenCheckoutGeneration: 'queued-gen',
    });

  expect(mockResolve).toHaveBeenCalledWith(
    'queued-gen',
    expect.objectContaining({
      frozen: true,
      liveGeneration: 'new-purchase-gen',
    })
  );
  expect(effectiveCheckoutGeneration).toBe('queued-gen');
});

it('keeps queued replays pinned even when live matches the restored value', async () => {
  checkoutGenerationRestoreGate.noteRestoredGeneration('restored-gen');
  mockLiveGeneration = 'restored-gen';

  const { effectiveCheckoutGeneration } =
    await resolveEffectiveCheckoutGeneration({
      checkoutGeneration: 'queued-gen',
      frozenCheckoutGeneration: 'queued-gen',
      queuedReplay: true,
    });

  expect(mockResolve).toHaveBeenCalledWith(
    'queued-gen',
    expect.objectContaining({ frozen: true, persistFrozen: false })
  );
  expect(effectiveCheckoutGeneration).toBe('queued-gen');
});

it('passes through when nothing is frozen', async () => {
  const { attemptKeyOptions, effectiveCheckoutGeneration } =
    await resolveEffectiveCheckoutGeneration({
      checkoutGeneration: 'fallback-gen',
    });

  expect(mockResolve).toHaveBeenCalledWith('fallback-gen', undefined);
  expect(attemptKeyOptions).toBeUndefined();
  expect(effectiveCheckoutGeneration).toBe('fallback-gen');
});

it('fails closed when the restore cannot settle', async () => {
  jest.useFakeTimers();
  checkoutGenerationRestoreGate.noteRestoreStarted(
    new Promise<never>(() => undefined)
  );

  const resolving = resolveEffectiveCheckoutGeneration({
    checkoutGeneration: 'stale-cart',
    frozenCheckoutGeneration: 'stale-cart',
  });
  const assertion = expect(resolving).rejects.toThrow(
    'Checkout generation restore timed out'
  );
  await jest.advanceTimersByTimeAsync(5_000);
  await assertion;
  expect(mockResolve).not.toHaveBeenCalled();
});
