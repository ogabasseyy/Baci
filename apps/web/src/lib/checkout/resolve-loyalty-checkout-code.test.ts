import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { resolveLoyaltyCheckoutCode } from './resolve-loyalty-checkout-code';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

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

function clientWith(
  rpcImpl: () => unknown,
  merchantRow: unknown = { country: 'NG', payout_currency: 'NGN' }
): SupabaseClient {
  return {
    rpc: vi.fn(async () => rpcImpl()),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: merchantRow, error: null })),
        })),
      })),
    })),
  } as unknown as SupabaseClient;
}

describe('resolveLoyaltyCheckoutCode', () => {
  it('resolves a bridgeable code to fixed economics', async () => {
    const resolution = await resolveLoyaltyCheckoutCode({
      supabase: clientWith(() => ({ data: [ROW], error: null })),
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
    const resolution = await resolveLoyaltyCheckoutCode({
      supabase: clientWith(() => ({
        data: [{ ...ROW, max_redemption_percentage: 25 }],
        error: null,
      })),
      merchantId: 'm',
      code: 'RDM-CAPPED',
    });

    expect(resolution).toMatchObject({ ok: true, maxRedemptionPercentage: 25 });
  });

  it('rejects a minimum-carrying percentage code after a currency change', async () => {
    const resolution = await resolveLoyaltyCheckoutCode({
      supabase: clientWith(
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
      ),
      merchantId: 'm',
      code: 'RDM-PCTMIN',
    });

    expect(resolution.ok).toBe(false);
  });

  it('maps a plain discount to fixed and percentage to proportional', async () => {
    const plain = await resolveLoyaltyCheckoutCode({
      supabase: clientWith(() => ({
        data: [{ ...ROW, reward_type: 'discount' }],
        error: null,
      })),
      merchantId: 'm',
      code: 'RDM-PLAIN',
    });
    const percent = await resolveLoyaltyCheckoutCode({
      supabase: clientWith(() => ({
        data: [{ ...ROW, reward_type: 'discount_percentage' }],
        error: null,
      })),
      merchantId: 'm',
      code: 'RDM-PCT',
    });

    expect(plain).toMatchObject({ ok: true, discountType: 'fixed' });
    expect(percent).toMatchObject({ ok: true, discountType: 'percentage' });
  });

  it('rejects non-discount types as invalid without gating resolve-time state', async () => {
    const resolution = await resolveLoyaltyCheckoutCode({
      supabase: clientWith(() => ({
        data: [{ ...ROW, reward_type: 'free_shipping', reward_value: null }],
        error: null,
      })),
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
    const resolution = await resolveLoyaltyCheckoutCode({
      supabase: clientWith(() => ({
        data: [{ ...ROW, used: true }],
        error: null,
      })),
      merchantId: 'm',
      code: 'RDM-USED',
    });

    expect(resolution.ok).toBe(true);
  });

  it('lets a used code reach replay even after a currency change', async () => {
    const resolution = await resolveLoyaltyCheckoutCode({
      supabase: clientWith(
        () => ({ data: [{ ...ROW, used: true }], error: null }),
        { country: 'US', payout_currency: 'USD' }
      ),
      merchantId: 'm',
      code: 'RDM-USED',
    });

    expect(resolution.ok).toBe(true);
  });

  it('rejects a fixed code whose issuance currency no longer matches', async () => {
    const resolution = await resolveLoyaltyCheckoutCode({
      supabase: clientWith(() => ({ data: [ROW], error: null }), {
        country: 'US',
        payout_currency: 'USD',
      }),
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
    const resolution = await resolveLoyaltyCheckoutCode({
      supabase: clientWith(
        () => ({
          data: [{ ...ROW, reward_type: 'discount_percentage' }],
          error: null,
        }),
        { country: 'US', payout_currency: 'USD' }
      ),
      merchantId: 'm',
      code: 'RDM-PCT',
    });

    expect(resolution.ok).toBe(true);
  });

  it('lets the wrapper decide when the merchant lookup finds no row', async () => {
    const resolution = await resolveLoyaltyCheckoutCode({
      supabase: clientWith(() => ({ data: [ROW], error: null }), null),
      merchantId: 'm',
      code: 'RDM-ABCDEF12',
    });

    expect(resolution.ok).toBe(true);
  });

  it('maps a lookup failure to 500 without masking it as invalid', async () => {
    const resolution = await resolveLoyaltyCheckoutCode({
      supabase: clientWith(() => ({ data: null, error: { message: 'boom' } })),
      merchantId: 'm',
      code: 'RDM-ABCDEF12',
    });

    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.response.status).toBe(500);
    }
  });
});
