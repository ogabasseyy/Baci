import { describe, expect, it } from 'vitest';
import { adminMerchant360RpcSchema } from './admin-merchant-360-rpc';

const validPayload = {
  domain: {
    hasPrimary: true,
    primaryDomain: 'shop.example.com',
    sslStatus: 'active',
    status: 'verified',
    verifiedAt: '2026-08-05T14:00:00+01:00',
  },
  generatedAt: '2026-08-05T14:00:00+01:00',
  moneyCurrency: 'NGN',
  incidents: {
    domainEventFailures30d: 0,
    eventDeliveryDeadLetters30d: 0,
    shipmentFailures30d: 0,
  },
  merchant: {
    businessName: 'Baci Store',
    createdAt: '2026-08-01T14:00:00+01:00',
    id: '123e4567-e89b-42d3-a456-426614174000',
    isPublished: true,
    planTier: 'growth',
    signupSource: 'web',
    slug: 'baci-store',
    updatedAt: null,
  },
  payouts: {
    completedAmount: 25_000,
    completedCount: 1,
    failedAmount: -20,
    failedCount: 0,
    pendingAmount: 0,
    pendingCount: 0,
  },
  readiness: {
    hasStorefrontSlug: true,
    isPublished: true,
    paymentConfigured: true,
    shippingConfigured: false,
    storefrontReady: false,
  },
  recentAuditEvents: [
    {
      action: 'merchant.updated',
      changedFields: ['business_name'],
      occurredAt: '2026-08-05T14:00:00+01:00',
      resourceType: 'merchant',
    },
  ],
  sales: {
    displayCurrencyPaidOrders: 3,
    excludedNonDisplayCurrencyPaidOrders: 1,
    lastPaidAt: null,
    paidGmv: -50,
    paidOrders: 4,
  },
  staffAccess: [{ role: 'owner', status: 'active', users: 1 }],
  settlements: {
    currency: null,
    failedAmount: null,
    failedCount: 0,
    pendingAmount: null,
    pendingCount: 0,
    settledAmount: null,
    settledCount: 0,
  },
  summary: {
    activeAdminAppInstallations: 0,
    activeStorefrontAppInstallations: 0,
    customerUsers: 2,
    staffUsers: 1,
    unmatchedAppUsers: 0,
    webUsers: 3,
  },
} as const;

describe('adminMerchant360RpcSchema', () => {
  it('accepts a currencyless settlement ledger and negative anomaly amounts', () => {
    const parsed = adminMerchant360RpcSchema.parse(validPayload);

    expect(parsed.settlements.currency).toBeNull();
    expect(parsed.payouts.failedAmount).toBe(-20);
    expect(parsed.sales.paidGmv).toBe(-50);
  });

  it('accepts withheld payout totals when payout history spans currencies', () => {
    const parsed = adminMerchant360RpcSchema.parse({
      ...validPayload,
      payouts: {
        ...validPayload.payouts,
        completedAmount: null,
        failedAmount: null,
        pendingAmount: null,
      },
    });

    expect(parsed.payouts.pendingAmount).toBeNull();
  });

  it.each([
    { moneyCurrency: 'ngn' },
    { merchant: { ...validPayload.merchant, id: 'not-a-uuid' } },
    { incidents: { ...validPayload.incidents, shipmentFailures30d: -1 } },
    {
      payouts: {
        ...validPayload.payouts,
        pendingAmount: Number.POSITIVE_INFINITY,
      },
    },
    { settlements: { ...validPayload.settlements, currency: 'NGN' } },
  ])('rejects invalid operational read-model data: %o', (override) => {
    expect(
      adminMerchant360RpcSchema.safeParse({ ...validPayload, ...override })
        .success
    ).toBe(false);
  });
});
