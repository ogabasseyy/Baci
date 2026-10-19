import { describe, expect, it } from 'vitest';
import { POST } from './route.loyalty-bridge.mocks.test-support';
import {
  LOYALTY_CODE_ROW,
  loyaltyRequest,
  orderRowWithDiscount,
  setupLoyaltyBridge,
} from './route.loyalty-bridge.test-support';

// Loyalty-checkout cases (issue #3165), split from oversized route.test.ts.
describe('POST /api/orders loyalty-code bridge', () => {
  it('dispatches create_storefront_order_with_loyalty_code after a merchant-code miss', async () => {
    const supabase = await setupLoyaltyBridge({
      get_storefront_discount_code: { data: [], error: null },
      get_loyalty_redemption_for_checkout: {
        data: [LOYALTY_CODE_ROW],
        error: null,
      },
      create_storefront_order_with_loyalty_code: {
        data: [orderRowWithDiscount],
        error: null,
      },
    });

    const response = await POST(
      loyaltyRequest({ discount_code: 'RDM-ABCDEF12' })
    );

    expect(response.status).toBeLessThan(400);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order_with_loyalty_code',
      expect.objectContaining({
        p_loyalty_redemption_id: LOYALTY_CODE_ROW.redemption_id,
        p_discount_amount: 100,
      })
    );
  });
  it('maps loyalty_code_already_used to 409', async () => {
    await setupLoyaltyBridge({
      get_storefront_discount_code: { data: [], error: null },
      get_loyalty_redemption_for_checkout: {
        data: [LOYALTY_CODE_ROW],
        error: null,
      },
      create_storefront_order_with_loyalty_code: {
        data: null,
        error: { message: 'loyalty_code_already_used' },
      },
    });
    const response = await POST(
      loyaltyRequest({ discount_code: 'RDM-ABCDEF12' })
    );
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('loyalty_code_already_used');
  });
  it('bridges a plain discount loyalty code with fixed semantics', async () => {
    const supabase = await setupLoyaltyBridge({
      get_storefront_discount_code: { data: [], error: null },
      get_loyalty_redemption_for_checkout: {
        data: [
          { ...LOYALTY_CODE_ROW, reward_type: 'discount', reward_value: 100 },
        ],
        error: null,
      },
      create_storefront_order_with_loyalty_code: {
        data: [orderRowWithDiscount],
        error: null,
      },
    });
    const response = await POST(
      loyaltyRequest({ discount_code: 'RDM-ABCDEF12' })
    );
    expect(response.status).toBeLessThan(400);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order_with_loyalty_code',
      expect.objectContaining({ p_discount_amount: 100 })
    );
  });
});
