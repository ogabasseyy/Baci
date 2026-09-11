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
});
