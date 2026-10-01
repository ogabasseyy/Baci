import { describe, expect, it, vi } from 'vitest';
import { resolveAdsSyncRun } from './resolve-sync-run';

describe('resolveAdsSyncRun', () => {
  it('creates both ordering values on the server for a new run', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000001'
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T10:00:00.000Z'));

    await expect(
      resolveAdsSyncRun({
        merchantId: 'merchant-1',
        provider: 'google_ads',
        supabase: { rpc: vi.fn() } as never,
      })
    ).resolves.toEqual({
      syncRunId: '00000000-0000-4000-8000-000000000001',
      syncRunStartedAt: '2026-08-28T10:00:00.000Z',
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses the persisted timestamp and ignores a caller timestamp on continuation', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: '2026-08-28T09:00:00.000Z',
      error: null,
    });

    await expect(
      resolveAdsSyncRun({
        merchantId: 'merchant-1',
        provider: 'google_ads',
        requestedSyncRunId: '00000000-0000-4000-8000-000000000002',
        supabase: { rpc } as never,
      })
    ).resolves.toEqual({
      syncRunId: '00000000-0000-4000-8000-000000000002',
      syncRunStartedAt: '2026-08-28T09:00:00.000Z',
    });
    expect(rpc).toHaveBeenCalledWith('get_merchant_ads_sync_run_started_at', {
      p_merchant_id: 'merchant-1',
      p_provider: 'google_ads',
      p_sync_run_id: '00000000-0000-4000-8000-000000000002',
    });
  });

  it('rejects a continuation when the run is no longer current', async () => {
    await expect(
      resolveAdsSyncRun({
        merchantId: 'merchant-1',
        provider: 'google_ads',
        requestedSyncRunId: '00000000-0000-4000-8000-000000000003',
        supabase: {
          rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as never,
      })
    ).resolves.toBeNull();
  });
});
