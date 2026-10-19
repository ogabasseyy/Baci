import { describe, expect, it } from 'vitest';
import { adminPlatformAnalyticsRpcSchema } from '@/schemas/admin-platform-analytics-rpc';

const validPayload = {
  businessTypeCounts: [{ businessType: 'fashion', merchants: 75 }],
  dailyGmv: [],
  generatedAt: '2026-08-05T14:00:00+00:00',
  growth: {
    gmvGrowthRate: 2,
    merchantGrowthRate: -10,
    newMerchantsThisMonth: 3,
  },
  merchantActivation: [],
  merchantHealth: { atRisk: 0, churned: 1, healthy: 1, new: 73 },
  paymentMethods: [],
  paymentStatuses: [],
  salesByChannel: [],
  shippingStatuses: [],
  signupSources: [{ merchants: 75, shareOfMerchants: 100, source: 'web' }],
  summary: {
    activeMerchantChange: 12,
    activeMerchants: 56,
    aovChange: -4,
    avgGmvPerMerchant: 1_006_250_410.72,
    avgOrderValue: 724_442.34,
    gmvChange: 8,
    grossGmv: 4_138_510_676.5,
    grossOrders: 4861,
    excludedNonNgnOrUnknownGrossOrders: 9,
    excludedNonNgnOrUnknownPaidOrders: 4,
    recordedMerchantNet: null,
    orderChange: 5,
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

describe('adminPlatformAnalyticsRpcSchema', () => {
  it('accepts complete aggregates above Supabase row limits', () => {
    const parsed = adminPlatformAnalyticsRpcSchema.parse(validPayload);

    expect(parsed.summary.grossOrders).toBe(4861);
    expect(parsed.summary.totalOrders).toBe(2778);
    expect(parsed.summary.activeMerchants).toBe(56);
  });

  it('rejects incomplete legacy summary payloads', () => {
    expect(() =>
      adminPlatformAnalyticsRpcSchema.parse({
        ...validPayload,
        summary: { totalGmv: 24_400_000, totalOrders: 13 },
      })
    ).toThrow();
  });

  it.each([
    {
      payload: {
        ...validPayload,
        paymentMethods: [
          {
            amount: 100,
            label: 'Card',
            method: 'card',
            orders: 1,
            shareOfPaidAmount: 100.1,
            shareOfPaidOrders: 100,
          },
        ],
      },
      scenario: 'a payment-method share exceeds 100 percent',
    },
    {
      payload: {
        ...validPayload,
        signupSources: [
          { merchants: 1, shareOfMerchants: -0.1, source: 'web' as const },
        ],
      },
      scenario: 'a share is negative',
    },
  ])('rejects an aggregate when $scenario', ({ payload }) => {
    expect(adminPlatformAnalyticsRpcSchema.safeParse(payload).success).toBe(
      false
    );
  });
});
