import { act, renderHook, waitFor } from '@testing-library/react';
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

  it('skips the post-enroll refresh when the identity changed mid-flight', async () => {
    const statusUrls: string[] = [];
    let resolveEnroll: ((value: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes('/enroll')) {
        return new Promise((resolve) => {
          resolveEnroll = resolve;
        });
      }
      statusUrls.push(url);
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });

    const { result, rerender } = renderHook(
      ({ merchant, customer }: { merchant: string; customer: string }) =>
        useLoyalty(merchant, customer),
      {
        initialProps: { merchant: 'merchant-1', customer: 'customer-1' },
      }
    );
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let enrollPromise: Promise<unknown> | undefined;
    act(() => {
      enrollPromise = result.current.enroll();
    });
    rerender({ merchant: 'merchant-2', customer: 'customer-2' });
    await waitFor(() => {
      expect(
        statusUrls.some((url) => url.includes('merchant_id=merchant-2'))
      ).toBe(true);
    });

    await act(async () => {
      resolveEnroll?.({
        ok: true,
        json: () =>
          Promise.resolve({
            data: { points_balance: 10, tier: 'bronze', referral_code: 'X' },
          }),
      } as Response);
      await enrollPromise;
    });

    expect(
      statusUrls.filter((url) => url.includes('merchant_id=merchant-1'))
    ).toHaveLength(1);
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

  it('getTierInfo treats an empty configured tier as authoritative', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        enrolled: true,
        tier: 'silver',
        points_balance: 10,
        tiers: [{ name: 'Silver', multiplier: null, perks: [] }],
      }),
    } as Response);

    const { result } = renderHook(() => useLoyalty('merchant-1', 'customer-1'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // No invented 1.5x/early-access/shipping promises for a rung the
    // merchant configured with no multiplier and no perks.
    expect(result.current.getTierInfo('silver').benefits).toEqual([]);
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

  it('reuses the idempotency key across retries until success', async () => {
    const failPayload = { error: 'Insufficient points' };
    const successPayload = {
      data: {
        redemption_code: 'RDM-1',
        reward_name: 'Perk',
        reward_type: 'discount',
        points_spent: 100,
        new_balance: 400,
        expires_at: '2026-11-09T00:00:00.000Z',
        instructions: 'Apply this code at checkout.',
      },
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => failPayload,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => successPayload,
      } as Response)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => successPayload,
      } as Response)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response);

    const { result } = renderHook(() => useLoyalty('merchant-1', 'customer-1'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const failed = await result.current.redeemReward('reward-9');
    expect(failed.success).toBe(false);
    const retried = await result.current.redeemReward('reward-9');
    expect(retried.success).toBe(true);
    const again = await result.current.redeemReward('reward-9');
    expect(again.success).toBe(true);

    const redeemCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) =>
        String(url).includes('/api/storefront/loyalty/redeem')
      );
    expect(redeemCalls).toHaveLength(3);
    const keys = redeemCalls.map(
      ([, init]) => (init?.headers as Record<string, string>)['Idempotency-Key']
    );
    // Failure then retry share one key; post-success redeems mint fresh.
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('ignores a stale load that resolves after a newer refetch', async () => {
    let resolveFirst!: (value: Response) => void;
    let resolveSecond!: (value: Response) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(
        () =>
          new Promise<Response>((r) => {
            resolveFirst = r;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((r) => {
            resolveSecond = r;
          })
      );

    const { result } = renderHook(() => useLoyalty('merchant-1', 'customer-1'));
    let refetchPromise!: Promise<void>;
    act(() => {
      refetchPromise = result.current.refetch();
    });

    const fresh = { enrolled: true, points_balance: 222 };
    await act(async () => {
      resolveSecond({ ok: true, json: async () => fresh } as Response);
      await refetchPromise;
    });
    expect(result.current.data).toMatchObject({ points_balance: 222 });

    // The aborted first request resolves last: its payload and its
    // loading=false must both be discarded.
    await act(async () => {
      resolveFirst({
        ok: true,
        json: async () => ({ enrolled: true, points_balance: 111 }),
      } as Response);
      await Promise.resolve();
    });
    expect(result.current.data).toMatchObject({ points_balance: 222 });
  });
});
