import { describe, expect, it, vi } from 'vitest';
import { markAdsSyncStarted, markFinalAdsSync } from './mark-final-ads-sync';

describe('markAdsSyncStarted', () => {
  const base = {
    merchantId: 'merchant-1',
    provider: 'google_ads',
    providerCustomerId: 'customer-1',
    syncRunId: '00000000-0000-4000-8000-000000000001',
    syncRunStartedAt: '2026-08-27T22:00:00.000Z',
    syncWindowEndDate: '2026-08-27',
    syncWindowStartDate: '2026-08-01',
    supabase: { rpc: vi.fn() } as never,
  };

  it('clears the freshness marker through the authenticated CAS boundary', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      markAdsSyncStarted({ ...base, supabase: { rpc } as never })
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'mark_merchant_ads_connection_sync_started_if_current',
      {
        p_merchant_id: 'merchant-1',
        p_provider: 'google_ads',
        p_provider_customer_id: 'customer-1',
        p_sync_run_id: '00000000-0000-4000-8000-000000000001',
        p_sync_run_started_at: '2026-08-27T22:00:00.000Z',
        p_sync_window_end_date: '2026-08-27',
        p_sync_window_start_date: '2026-08-01',
      }
    );
  });

  it('fails closed when the freshness marker cannot be cleared', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: false,
      error: { message: 'denied' },
    });

    await expect(
      markAdsSyncStarted({ ...base, supabase: { rpc } as never })
    ).resolves.toBe(false);
  });
});

describe('markFinalAdsSync', () => {
  it('skips intermediate chunks and marks only the final chunk', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const base = {
      merchantId: 'merchant-1',
      provider: 'google_ads',
      providerCustomerId: 'customer-1',
      syncRunId: '00000000-0000-4000-8000-000000000001',
      syncRunStartedAt: '2026-08-27T22:00:00.000Z',
      syncWindowEndDate: '2026-08-27',
      syncWindowStartDate: '2026-08-01',
      supabase: { rpc } as never,
    };

    await expect(
      markFinalAdsSync({ ...base, finalChunk: false })
    ).resolves.toBe(true);
    expect(rpc).not.toHaveBeenCalled();

    await expect(markFinalAdsSync(base)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'mark_merchant_ads_connection_synced_if_current',
      {
        p_merchant_id: 'merchant-1',
        p_provider: 'google_ads',
        p_provider_customer_id: 'customer-1',
        p_sync_run_id: '00000000-0000-4000-8000-000000000001',
        p_sync_window_end_date: '2026-08-27',
        p_sync_window_start_date: '2026-08-01',
      }
    );
  });

  it('does not report a stale refresh as fresh when the final CAS loses', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });

    await expect(
      markFinalAdsSync({
        finalChunk: true,
        merchantId: 'merchant-1',
        provider: 'google_ads',
        providerCustomerId: 'customer-1',
        syncRunId: '00000000-0000-4000-8000-000000000001',
        syncWindowEndDate: '2026-08-27',
        syncWindowStartDate: '2026-08-01',
        supabase: { rpc } as never,
      })
    ).resolves.toBe(false);
  });
});
