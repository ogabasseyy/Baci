import { describe, expect, it, vi } from 'vitest';
import { runWithGiglTrackingTokenCache } from './gigl-tracking-cache-runner';

const token = {
  token: 'synthetic-token',
  userChannelCode: 'channel',
  customerType: 1,
  expiresAt: 1_900_000_000_000,
};

describe('tracking token cache integration', () => {
  it('restores a token and persists a refreshed token after a batch', async () => {
    const cache = {
      load: vi.fn().mockResolvedValue(token),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const refreshed = { ...token, token: 'synthetic-refreshed' };
    const provider = { currentToken: refreshed };
    const createProvider = vi.fn().mockReturnValue(provider);
    const run = vi.fn().mockResolvedValue('done');
    await expect(
      runWithGiglTrackingTokenCache({ cache, createProvider, run })
    ).resolves.toBe('done');
    expect(createProvider).toHaveBeenCalledWith(token);
    expect(run).toHaveBeenCalledWith(provider);
    expect(cache.save).toHaveBeenCalledWith(refreshed);
  });

  it('removes a rejected token even if the batch throws', async () => {
    const cache = {
      load: vi.fn().mockResolvedValue(token),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const error = new Error('batch failed');
    await expect(
      runWithGiglTrackingTokenCache({
        cache,
        createProvider: () => ({ currentToken: null }),
        run: async () => {
          throw error;
        },
      })
    ).rejects.toBe(error);
    expect(cache.clear).toHaveBeenCalledOnce();
  });

  it('continues the batch when the cache is unavailable', async () => {
    const cache = {
      load: vi.fn().mockRejectedValue(new Error('unavailable')),
      save: vi.fn().mockRejectedValue(new Error('unavailable')),
      clear: vi.fn(),
    };
    const createProvider = vi.fn().mockReturnValue({ currentToken: token });
    await expect(
      runWithGiglTrackingTokenCache({
        cache,
        createProvider,
        run: async () => 'done',
      })
    ).resolves.toBe('done');
    expect(createProvider).toHaveBeenCalledWith(null);
  });
});
