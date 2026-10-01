import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPublishedStorefrontComparisonRevision } from './get-published-storefront-comparison-revision';

const mockRpc = vi.fn();

vi.mock('@/lib/public-supabase-client', () => ({
  getPublicSupabaseClient: () => ({ rpc: mockRpc }),
}));

describe('getPublishedStorefrontComparisonRevision', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('preserves a bigint revision as a cache-key-safe string', async () => {
    mockRpc.mockResolvedValueOnce({ data: '9007199254740992', error: null });

    await expect(
      getPublishedStorefrontComparisonRevision('merchant-1')
    ).resolves.toBe('9007199254740992');
  });

  it('does not turn an unavailable revision into a shared cache key', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      getPublishedStorefrontComparisonRevision('merchant-1')
    ).resolves.toBeNull();
  });

  it('propagates read failures so callers can select their local fallback', async () => {
    const failure = { message: 'database unavailable' };
    mockRpc.mockResolvedValueOnce({ data: null, error: failure });

    await expect(
      getPublishedStorefrontComparisonRevision('merchant-1')
    ).rejects.toBe(failure);
  });

  it('bounds a stalled public revision RPC to one aborted attempt', async () => {
    vi.useFakeTimers();
    const retry = vi.fn(() => new Promise<never>(() => undefined));
    const query = {
      abortSignal: vi.fn(() => query),
      retry,
    };
    mockRpc.mockReturnValueOnce(query);

    const result = getPublishedStorefrontComparisonRevision('merchant-1');
    const outcome = result.then(
      () => 'resolved',
      () => 'rejected'
    );
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(outcome).resolves.toBe('rejected');
    expect(query.abortSignal).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledWith(false);
  });
});
