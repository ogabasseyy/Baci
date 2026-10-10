import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLoyalty } from './use-loyalty';

describe('useLoyalty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('does not fetch without merchantId or customerId', async () => {
    const { result } = renderHook(() => useLoyalty());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it('returns mock data for preview merchants', async () => {
    const { result } = renderHook(() =>
      useLoyalty('store-preview', 'customer-1')
    );
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.enrolled).toBe(true);
    expect(result.current.pointsBalance).toBe(150);
    expect(result.current.tier).toBe('silver');
  });

  it('returns mock data for demo merchants', async () => {
    const { result } = renderHook(() => useLoyalty('demo-store', 'customer-1'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.enrolled).toBe(true);
  });

  it('handles 404 response (loyalty not available)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const { result } = renderHook(() => useLoyalty('merchant-1', 'customer-1'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('calculatePoints returns correct value', async () => {
    const { result } = renderHook(() =>
      useLoyalty('store-preview', 'customer-1')
    );
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.calculatePoints(500)).toBe(500);
  });

  it('getTierInfo returns colors and benefits', async () => {
    const { result } = renderHook(() =>
      useLoyalty('store-preview', 'customer-1')
    );
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    const info = result.current.getTierInfo('gold');
    expect(info.colors.bg).toBe('bg-yellow-100');
    expect(info.benefits.length).toBeGreaterThan(0);
  });

  it('getTierInfo renders merchant-defined multipliers and perks', async () => {
    const { result } = renderHook(() =>
      useLoyalty('store-preview', 'customer-1')
    );
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    // Preview ladder mirrors the persisted defaults (1.25x Silver), not
    // the hardcoded 1.5x fallback claims.
    expect(result.current.getTierInfo('silver').benefits).toEqual([
      'Earn 1.25x points',
      'Free shipping',
    ]);
    expect(result.current.getTierInfo('gold').benefits).toEqual([
      'Earn 1.5x points',
      'Free shipping',
      'Early access to sales',
    ]);
  });

  it('getTierInfo falls back for tiers missing from the ladder', async () => {
    const { result } = renderHook(() =>
      useLoyalty('store-preview', 'customer-1')
    );
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    // Unknown rung: bronze fallback copy, bronze colors.
    const info = result.current.getTierInfo('diamond');
    expect(info.colors.bg).toBe('bg-amber-100');
    expect(info.benefits).toContain('Access to basic rewards');
  });

  it('redeemReward maps reward_type through for the success dialog', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            redemption_code: 'RDM-CREDIT',
            reward_name: 'Wallet top-up',
            reward_type: 'store_credit',
            points_spent: 100,
            new_balance: 900,
            expires_at: '2026-11-09T00:00:00.000Z',
            instructions: 'The credit has been added.',
          },
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response);

    const { result } = renderHook(() => useLoyalty('merchant-1', 'customer-1'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const outcome = await result.current.redeemReward('reward-7');
    expect(outcome).toMatchObject({
      success: true,
      redemption_code: 'RDM-CREDIT',
      reward_type: 'store_credit',
    });
  });
});
