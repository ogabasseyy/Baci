import { describe, expect, it, vi } from 'vitest';
import { getAdminMerchant360 } from '@/lib/admin-merchant-360';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

function merchant360Payload() {
  return {
    domain: {
      hasPrimary: false,
      primaryDomain: null,
      sslStatus: null,
      status: null,
      verifiedAt: null,
    },
    generatedAt: '2026-03-20T10:00:00.000Z',
    moneyCurrency: 'NGN',
    incidents: {
      domainEventFailures30d: 0,
      eventDeliveryDeadLetters30d: 0,
      shipmentFailures30d: 0,
    },
    merchant: {
      businessName: 'Unpublished Store',
      createdAt: '2026-03-20T10:00:00.000Z',
      id: MERCHANT_ID,
      isPublished: false,
      planTier: 'free',
      signupSource: 'web',
      slug: 'unpublished-store',
      updatedAt: '2026-03-20T10:00:00.000Z',
    },
    payouts: {
      completedAmount: 0,
      completedCount: 0,
      failedAmount: 0,
      failedCount: 0,
      pendingAmount: 0,
      pendingCount: 0,
    },
    readiness: {
      hasStorefrontSlug: true,
      isPublished: false,
      paymentConfigured: true,
      shippingConfigured: true,
      storefrontReady: false,
    },
    recentAuditEvents: [],
    sales: {
      displayCurrencyPaidOrders: 0,
      excludedNonDisplayCurrencyPaidOrders: 0,
      lastPaidAt: null,
      paidGmv: 0,
      paidOrders: 0,
    },
    staffAccess: [{ role: 'manager', status: 'active', users: 2 }],
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
      customerUsers: 101,
      staffUsers: 0,
      unmatchedAppUsers: 0,
      webUsers: 102,
    },
  };
}

describe('getAdminMerchant360', () => {
  it('returns an unpublished foreign merchant and preserves an exact 101-customer count', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: merchant360Payload(),
      error: null,
    });

    const result = await getAdminMerchant360({ rpc } as never, MERCHANT_ID);

    expect(result.error).toBeNull();
    expect(result.data?.merchant.isPublished).toBe(false);
    expect(result.data?.summary.customerUsers).toBe(101);
    expect(rpc).toHaveBeenCalledWith('get_admin_merchant_360_v2', {
      p_merchant_id: MERCHANT_ID,
    });
  });

  it('returns the RPC authorization error for a non-admin caller', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'platform_admin_required' },
    });

    const result = await getAdminMerchant360({ rpc } as never, MERCHANT_ID);

    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({ code: '42501' });
  });

  it('strips unexpected people, credential, and customer fields from a successful payload', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ...merchant360Payload(),
        bank_account_number: '0000000000',
        customers: [{ email: 'customer@example.com' }],
        directory: {
          owner: {
            email: 'owner@example.com',
            userId: '22222222-2222-4222-8222-222222222222',
          },
        },
        paymentCredentialCiphertext: 'secret-ciphertext',
      },
      error: null,
    });

    const result = await getAdminMerchant360({ rpc } as never, MERCHANT_ID);
    const serialized = JSON.stringify(result.data);

    expect(serialized).not.toContain('secret-ciphertext');
    expect(serialized).not.toContain('0000000000');
    expect(serialized).not.toContain('customer@example.com');
    expect(serialized).not.toContain('owner@example.com');
    expect(serialized).not.toContain('22222222-2222-4222-8222-222222222222');
  });

  it('preserves a negative payout anomaly for operational investigation', async () => {
    const payload = merchant360Payload();
    payload.payouts.failedAmount = -500;
    const rpc = vi.fn().mockResolvedValue({ data: payload, error: null });

    const result = await getAdminMerchant360({ rpc } as never, MERCHANT_ID);

    expect(result.error).toBeNull();
    expect(result.data?.payouts.failedAmount).toBe(-500);
  });

  it('rejects settlement amounts because the ledger does not record a currency', async () => {
    const payload = merchant360Payload();
    payload.settlements.pendingAmount = 5000 as never;
    const rpc = vi.fn().mockResolvedValue({ data: payload, error: null });

    const result = await getAdminMerchant360({ rpc } as never, MERCHANT_ID);

    expect(result.error?.code).toBe('INVALID_MERCHANT_360_PAYLOAD');
  });
});
