import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLoyalty } from './use-loyalty';

vi.mock('@/lib/loyalty-redemption-keys', () => ({
  redemptionIdempotencyKeys: {
    forReward: vi
      .fn()
      .mockRejectedValue(
        new Error(
          'Redemption requires browser storage. Please enable storage and try again.'
        )
      ),
    clearForReward: vi.fn(),
  },
}));

describe('useLoyalty redeemReward storage failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response)
    );
  });

  it('resolves a failure result instead of rejecting when key storage is unavailable', async () => {
    const { result } = renderHook(() => useLoyalty('merchant-1', 'customer-1'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Callers (RewardsCatalog) only handle resolved results; a
    // rejection here would strand the redeem button without a toast.
    const outcome = await result.current.redeemReward('reward-1');
    expect(outcome).toEqual({
      success: false,
      error:
        'Redemption requires browser storage. Please enable storage and try again.',
    });
  });
});
