import { jest } from '@jest/globals';
import { applyPersistedCheckoutGeneration } from './apply-persisted-checkout-generation';

const mockRead = jest.fn<() => Promise<string | null>>();

jest.mock('@/lib/read-persisted-checkout-generation', () => ({
  readPersistedCheckoutGeneration: () => mockRead(),
}));

describe('bugfix: checkout-generation rehydration failures', () => {
  beforeEach(() => {
    mockRead.mockReset();
  });

  it('does not throw when the persisted generation read rejects', async () => {
    mockRead.mockRejectedValueOnce(new Error('AsyncStorage unavailable'));
    const setCheckoutGeneration = jest.fn<(generation: string) => void>();

    await expect(
      applyPersistedCheckoutGeneration(setCheckoutGeneration)
    ).resolves.toBeUndefined();
    expect(setCheckoutGeneration).not.toHaveBeenCalled();
  });

  it('does not restore a stale generation after the live cart identity changes', async () => {
    let liveGeneration = 'generation-a';
    let resolveRead!: (value: string | null) => void;
    mockRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        })
    );
    const setCheckoutGeneration = jest.fn<(generation: string) => void>();

    const applyPromise = applyPersistedCheckoutGeneration(
      setCheckoutGeneration,
      {
        generationWhenReadBegan: 'generation-a',
        getLiveGeneration: () => liveGeneration,
      }
    );
    liveGeneration = 'generation-b';
    resolveRead('generation-a');
    await applyPromise;

    expect(setCheckoutGeneration).not.toHaveBeenCalled();
    expect(liveGeneration).toBe('generation-b');
  });
});
