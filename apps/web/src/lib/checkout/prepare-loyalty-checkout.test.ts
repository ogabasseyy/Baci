import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/checkout/canonical-order-subtotal', () => ({
  computeCanonicalOrderSubtotal: vi.fn(async () => 10_000),
  isCanonicalOrderSubtotalUuidError: () => false,
}));

const mockResolveLoyalty = vi.fn();
vi.mock('@/lib/checkout/resolve-loyalty-checkout-code', () => ({
  resolveLoyaltyCheckoutCode: (...args: unknown[]) =>
    mockResolveLoyalty(...args),
}));

import { prepareLoyaltyCheckout } from './prepare-loyalty-checkout';

const ITEMS = [{ product_id: 'p-1', quantity: 1, assurance_fee: 0 }];

function clientWithRpc(rpcResult: unknown): SupabaseClient {
  return {
    rpc: vi.fn(async () => rpcResult),
  } as unknown as SupabaseClient;
}

const BASE = {
  merchantId: 'merchant-1',
  requestedDiscountCode: 'CODE10',
  hasVoucherItem: false,
  requestedSavingsRedemption: false,
  items: ITEMS,
};

const INACTIVE_MERCHANT_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'RDM-COLLIDE1',
  discount_type: 'fixed_amount',
  discount_value: 500,
  starts_at: null,
  expires_at: null,
  usage_limit: null,
  usage_count: 0,
  minimum_purchase_amount: null,
  maximum_discount_amount: null,
  description: null,
  applies_to: 'all',
  product_ids: [],
  category_ids: [],
  usage_limit_per_customer: null,
  is_active: false,
};

describe('prepareLoyaltyCheckout', () => {
  it('routes a deactivated merchant code to a matching loyalty redemption', async () => {
    mockResolveLoyalty.mockResolvedValue({
      ok: true,
      redemptionId: '22222222-2222-4222-8222-222222222222',
      discountType: 'fixed',
      discountValue: 500,
      maxRedemptionPercentage: null,
    });

    const result = await prepareLoyaltyCheckout({
      ...BASE,
      requestedDiscountCode: 'RDM-COLLIDE1',
      supabase: clientWithRpc({ data: [INACTIVE_MERCHANT_ROW], error: null }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.loyaltyRedemptionId).toBe(
        '22222222-2222-4222-8222-222222222222'
      );
      expect(result.discountCodeId).toBeNull();
    }
  });

  it('keeps an inactive merchant code on the merchant path without a loyalty match', async () => {
    mockResolveLoyalty.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 400 }),
    });

    const result = await prepareLoyaltyCheckout({
      ...BASE,
      requestedDiscountCode: 'RDM-COLLIDE1',
      supabase: clientWithRpc({ data: [INACTIVE_MERCHANT_ROW], error: null }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.discountCodeId).toBe(INACTIVE_MERCHANT_ROW.id);
      expect(result.loyaltyRedemptionId).toBeNull();
    }
  });

  it('rejects voucher combinations before any lookup', async () => {
    const result = await prepareLoyaltyCheckout({
      ...BASE,
      supabase: clientWithRpc({ data: null, error: null }),
      hasVoucherItem: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      await expect(result.response.json()).resolves.toMatchObject({
        code: 'DISCOUNT_CODE_VOUCHER_COMBINATION_UNSUPPORTED',
      });
    }
  });

  it('computes a merchant fixed-code amount from the canonical subtotal', async () => {
    const result = await prepareLoyaltyCheckout({
      ...BASE,
      supabase: clientWithRpc({
        data: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            code: 'CODE10',
            discount_type: 'fixed_amount',
            discount_value: 500,
            starts_at: null,
            expires_at: null,
            usage_limit: null,
            usage_count: 0,
            minimum_purchase_amount: null,
            maximum_discount_amount: null,
            description: null,
            applies_to: 'all',
            product_ids: [],
            category_ids: [],
            usage_limit_per_customer: null,
          },
        ],
        error: null,
      }),
    });
    expect(result).toEqual({
      ok: true,
      canonicalOrderSubtotal: 10_000,
      discountCodeId: '11111111-1111-4111-8111-111111111111',
      loyaltyRedemptionId: null,
      discountCodeAmount: 500,
    });
  });

  it('applies the snapshotted loyalty cap to percentage economics', async () => {
    mockResolveLoyalty.mockResolvedValue({
      ok: true,
      redemptionId: 'r-1',
      discountType: 'percentage',
      discountValue: 10,
      maxRedemptionPercentage: 5,
    });
    const result = await prepareLoyaltyCheckout({
      ...BASE,
      supabase: clientWithRpc({ data: [], error: null }),
    });
    // 10% of 10,000 = 1,000, capped at 5% of subtotal = 500.
    expect(result).toEqual({
      ok: true,
      canonicalOrderSubtotal: 10_000,
      discountCodeId: null,
      loyaltyRedemptionId: 'r-1',
      discountCodeAmount: 500,
    });
  });

  it('masks lookup failures as a 500, not an invalid-code 400', async () => {
    const result = await prepareLoyaltyCheckout({
      ...BASE,
      supabase: clientWithRpc({ data: null, error: { message: 'db down' } }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(500);
  });
});
