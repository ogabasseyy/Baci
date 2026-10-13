import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { getAdminPlatformAnalytics } from '@/lib/admin-platform-analytics';
import type { Database } from '@/types/supabase';

function createSupabaseClient(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient<Database>;
}

function createPayload() {
  return {
    businessTypeCounts: [{ businessType: 'fashion', merchants: 75 }],
    dailyGmv: [],
    generatedAt: '2026-08-05T14:00:00+00:00',
    growth: {
      gmvGrowthRate: 0,
      merchantGrowthRate: 0,
      newMerchantsThisMonth: 0,
    },
    merchantActivation: [],
    merchantHealth: { atRisk: 0, churned: 1, healthy: 1, new: 73 },
    paymentMethods: [],
    paymentStatuses: [],
    salesByChannel: [],
    shippingStatuses: [],
    signupSources: [],
    summary: {
      activeMerchantChange: 0,
      activeMerchants: 56,
      aovChange: 0,
      avgGmvPerMerchant: 1_006_250_410.72,
      avgOrderValue: 724_442.34,
      gmvChange: 0,
      grossGmv: 4_138_510_676.5,
      grossOrders: 4861,
      excludedNonNgnOrUnknownGrossOrders: 9,
      excludedNonNgnOrUnknownPaidOrders: 4,
      recordedMerchantNet: null,
      orderChange: 0,
      recordedPlatformFees: null,
      recordedProcessorFees: null,
      reportingCurrency: 'NGN' as const,
      sellingMerchants: 2,
      totalGmv: 2_012_500_821.44,
      totalMerchants: 75,
      totalOrders: 2778,
    },
    topMerchants: [],
  };
}

describe('getAdminPlatformAnalytics', () => {
  it('preserves complete aggregate counts beyond the default row cap', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: createPayload(), error: null });
    const supabase = createSupabaseClient(rpc);

    const result = await getAdminPlatformAnalytics(supabase, 'all');

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('get_admin_platform_analytics', {
      p_period: 'all',
    });
    expect(result.error).toBeNull();
    expect(result.data?.summary.grossOrders).toBe(4861);
    expect(result.data?.summary.totalOrders).toBe(2778);
    expect(result.data?.businessTypes[0]?.merchants).toBe(75);
  });

  it('fails closed when the aggregate payload is malformed', async () => {
    const supabase = createSupabaseClient(
      vi.fn().mockResolvedValue({ data: { summary: {} }, error: null })
    );

    const result = await getAdminPlatformAnalytics(supabase, '30d');

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('INVALID_ANALYTICS_PAYLOAD');
  });

  it('propagates database errors without returning partial analytics', async () => {
    const supabase = createSupabaseClient(
      vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'Platform admin access required' },
      })
    );

    const result = await getAdminPlatformAnalytics(supabase, '7d');

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('42501');
  });
});
