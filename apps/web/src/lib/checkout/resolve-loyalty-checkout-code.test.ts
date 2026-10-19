import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveLoyaltyCheckoutCode } from './resolve-loyalty-checkout-code';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from '@/lib/supabase/service';

const mockCreateServiceClient = vi.mocked(createServiceClient);

const ROW = {
  redemption_id: '22222222-2222-4222-8222-222222222222',
  reward_type: 'discount_fixed',
  reward_value: 100,
  minimum_order_amount: null,
  expires_at: null,
  used: false,
  issuance_currency: 'NGN',
  max_redemption_percentage: null,
  minimum_known: true,
  reward_name: 'Probe reward',
};

function serviceClientWith(
  rpcImpl: () => unknown,
  merchantRow: unknown = { country: 'NG', payout_currency: 'NGN' }
) {
  const rpc = vi.fn(async () => rpcImpl());
  const client = {
    rpc,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: merchantRow, error: null })),
        })),
      })),
    })),
  } as unknown as SupabaseClient;
  mockCreateServiceClient.mockReturnValue(client as never);
  return { client, rpc };
}

describe('resolveLoyaltyCheckoutCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves through the service-role client, never anon (issue #3696)', async () => {
    const { rpc } = serviceClientWith(() => ({ data: [ROW], error: null }));

    const resolution = await resolveLoyaltyCheckoutCode({
      merchantId: 'm',
      code: 'RDM-ABCDEF12',
    });

    expect(mockCreateServiceClient).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_loyalty_redemption_for_checkout', {
      p_merchant_id: 'm',
      p_code: 'RDM-ABCDEF12',
    });
    expect(resolution.ok).toBe(true);
  });

  it('resolves a bridgeable code to fixed economics', async () => {
    serviceClientWith(() => ({ data: [ROW], error: null }));
    const resolution = await resolveLoyaltyCheckoutCode({
      merchantId: 'm',
      code: 'RDM-ABCDEF12',
    });

    expect(resolution).toEqual({
      ok: true,
      redemptionId: ROW.redemption_id,
      discountType: 'fixed',
      discountValue: 100,
      maxRedemptionPercentage: null,
    });
  });

  it('passes the snapshotted max redemption percentage through', async () => {
    serviceClientWith(() => ({
      data: [{ ...ROW, max_redemption_percentage: 25 }],
      error: null,
    }));
    const resolution = await resolveLoyaltyCheckoutCode({
      merchantId: 'm',
      code: 'RDM-CAPPED',
    });

    expect(resolution).toMatchObject({ ok: true, maxRedemptionPercentage: 25 });
  });

  it('rejects a minimum-carrying percentage code after a currency change', async () => {
    serviceClientWith(
      () => ({
        data: [
          {
            ...ROW,
            reward_type: 'discount_percentage',
            minimum_order_amount: 5000,
          },
        ],
        error: null,
      }),
      { country: 'US', payout_currency: 'USD' }
    );
    const resolution = await resolveLoyaltyCheckoutCode({
      merchantId: 'm',
      code: 'RDM-PCTMIN',
    });

    expect(resolution.ok).toBe(false);
  });

  it('maps a plain discount to fixed and percentage to proportional', async () => {
    serviceClientWith(() => ({
      data: [{ ...ROW, reward_type: 'discount' }],
      error: null,
    }));
    const plain = await resolveLoyaltyCheckoutCode({
      merchantId: 'm',
      code: 'RDM-PLAIN',
    });
    serviceClientWith(() => ({
      data: [{ ...ROW, reward_type: 'discount_percentage' }],
      error: null,
    }));
    const percent = await resolveLoyaltyCheckoutCode({
      merchantId: 'm',
      code: 'RDM-PCT',
    });

    expect(plain).toMatchObject({ ok: true, discountType: 'fixed' });
    expect(percent).toMatchObject({ ok: true, discountType: 'percentage' });
  });

  it('rejects non-discount types as invalid without gating resolve-time state', async () => {
    serviceClientWith(() => ({
      data: [{ ...ROW, reward_type: 'free_shipping', reward_value: null }],
      error: null,
    }));
    const resolution = await resolveLoyaltyCheckoutCode({
      merchantId: 'm',
      code: 'RDM-SHIP',
    });

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.response.status).toBe(400);
      expect(await resolution.response.json()).toMatchObject({
        code: 'discount_code_invalid',
      });
    }
  });

  it('does not gate used codes: they must reach the wrapper for replay', async () => {
    serviceClientWith(() => ({
      data: [{ ...ROW, used: true }],
      error: null,
    }));
    const resolution = await resolveLoyaltyCheckoutCode({
      merchantId: 'm',
      code: 'RDM-USED',
    });

    expect(resolution.ok).toBe(true);
  });

  it('lets a used code reach replay even after a currency change', async () => {
    serviceClientWith(() => ({ data: [{ ...ROW, used: true }], error: null }), {
      country: 'US',
      payout_currency: 'USD',
    });
    const resolution = await resolveLoyaltyCheckoutCode({
      merchantId: 'm',
      code: 'RDM-USED',
    });

    expect(resolution.ok).toBe(true);
  });

  it('rejects a fixed code whose issuance currency no longer matches', async () => {
    serviceClientWith(() => ({ data: [ROW], error: null }), {
      country: 'US',
      payout_currency: 'USD',
    });
    const resolution = await resolveLoyaltyCheckoutCode({
      merchantId: 'm',
      code: 'RDM-ABCDEF12',
    });

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.response.status).toBe(400);
      expect(await resolution.response.json()).toMatchObject({
        code: 'discount_code_invalid',
      });
    }
  });

  it('keeps percentage codes currency-agnostic after a currency change', async () => {
    serviceClientWith(
      () => ({
        data: [{ ...ROW, reward_type: 'discount_percentage' }],
        error: null,
      }),
      { country: 'US', payout_currency: 'USD' }
    );
    const resolution = await resolveLoyaltyCheckoutCode({
      merchantId: 'm',
      code: 'RDM-PCT',
    });

    expect(resolution.ok).toBe(true);
  });

  it('lets the wrapper decide when the merchant lookup finds no row', async () => {
    serviceClientWith(() => ({ data: [ROW], error: null }), null);
    const resolution = await resolveLoyaltyCheckoutCode({
      merchantId: 'm',
      code: 'RDM-ABCDEF12',
    });

    expect(resolution.ok).toBe(true);
  });

  it('maps a lookup failure to 500 without masking it as invalid', async () => {
    serviceClientWith(() => ({ data: null, error: { message: 'boom' } }));
    const resolution = await resolveLoyaltyCheckoutCode({
      merchantId: 'm',
      code: 'RDM-ABCDEF12',
    });

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.response.status).toBe(500);
    }
  });
});
