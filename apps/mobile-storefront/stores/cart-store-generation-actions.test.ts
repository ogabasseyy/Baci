import { jest } from '@jest/globals';

const mockPersist = jest.fn<(generation: string) => Promise<void>>(
  async () => undefined
);

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'minted-generation',
}));
jest.mock('@/lib/persist-checkout-generation', () => ({
  persistCheckoutGeneration: (generation: string) => mockPersist(generation),
}));

const { createCheckoutGenerationActions } =
  require('./cart-store-generation-actions') as typeof import('./cart-store-generation-actions');
const { mintedCheckoutGenerations } =
  require('@/lib/minted-checkout-generations') as typeof import('@/lib/minted-checkout-generations');

beforeEach(() => {
  mockPersist.mockReset();
  mockPersist.mockResolvedValue(undefined);
});

describe('advanceCheckoutGeneration', () => {
  it('mints, persists, and applies a new checkout generation', async () => {
    const set = jest.fn();
    const { advanceCheckoutGeneration } = createCheckoutGenerationActions(
      set as never
    );

    await advanceCheckoutGeneration();

    expect(mockPersist).toHaveBeenCalledWith('minted-generation');
    expect(set).toHaveBeenCalledWith({
      checkoutGeneration: 'minted-generation',
    });
    expect(mintedCheckoutGenerations.isRegistered('minted-generation')).toBe(
      true
    );
  });

  it('propagates persist failures without applying the new generation', async () => {
    mockPersist.mockRejectedValueOnce(new Error('disk full'));
    const set = jest.fn();
    const { advanceCheckoutGeneration } = createCheckoutGenerationActions(
      set as never
    );

    await expect(advanceCheckoutGeneration()).rejects.toThrow('disk full');
    expect(set).not.toHaveBeenCalled();
  });
});

describe('restoreItems', () => {
  it('restores items and persists the restored generation', async () => {
    const set = jest.fn();
    const { restoreItems } = createCheckoutGenerationActions(set as never);
    const items = [{ id: 'line-1' }] as never[];

    await restoreItems(items, true, 'restored-generation');

    expect(set).toHaveBeenCalledWith({
      items,
      cartWideNegotiationActive: true,
      checkoutGeneration: 'restored-generation',
    });
    expect(mockPersist).toHaveBeenCalledWith('restored-generation');
  });

  it('skips the persist when no generation is restored', async () => {
    const set = jest.fn();
    const { restoreItems } = createCheckoutGenerationActions(set as never);
    const items = [{ id: 'line-1' }] as never[];

    await restoreItems(items, undefined, undefined);

    expect(set).toHaveBeenCalledWith({ items });
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it('swallows persist failures so restores still finish', async () => {
    mockPersist.mockRejectedValueOnce(new Error('disk full'));
    const set = jest.fn();
    const { restoreItems } = createCheckoutGenerationActions(set as never);

    await expect(
      restoreItems([], undefined, 'restored-generation')
    ).resolves.toBeUndefined();
  });
});
