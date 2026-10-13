import { describe, expect, it } from 'vitest';
import { POST } from './route.loyalty-bridge.mocks.test-support';
import {
  LOYALTY_CODE_ROW,
  loyaltyRequest,
  setupLoyaltyBridge,
} from './route.loyalty-bridge.test-support';

// Wrapper-error mapping cases for the loyalty bridge (issue #3165).
describe('POST /api/orders loyalty-code bridge errors', () => {
  it('maps loyalty_code_expired to 400', async () => {
    await setupLoyaltyBridge({
      get_storefront_discount_code: { data: [], error: null },
      get_loyalty_redemption_for_checkout: {
        data: [LOYALTY_CODE_ROW],
        error: null,
      },
      create_storefront_order_with_loyalty_code: {
        data: null,
        error: { message: 'loyalty_code_expired' },
      },
    });
    const response = await POST(
      loyaltyRequest({ discount_code: 'RDM-ABCDEF12' })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).details).toBe('loyalty_code_expired');
  });
  it('maps loyalty_code_currency_mismatch to 400', async () => {
    await setupLoyaltyBridge({
      get_storefront_discount_code: { data: [], error: null },
      get_loyalty_redemption_for_checkout: {
        data: [LOYALTY_CODE_ROW],
        error: null,
      },
      create_storefront_order_with_loyalty_code: {
        data: null,
        error: { message: 'loyalty_code_currency_mismatch' },
      },
    });
    const response = await POST(
      loyaltyRequest({ discount_code: 'RDM-ABCDEF12' })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).details).toBe(
      'loyalty_code_currency_mismatch'
    );
  });
  it('maps loyalty_reward_inactive to 400', async () => {
    await setupLoyaltyBridge({
      get_storefront_discount_code: { data: [], error: null },
      get_loyalty_redemption_for_checkout: {
        data: [LOYALTY_CODE_ROW],
        error: null,
      },
      create_storefront_order_with_loyalty_code: {
        data: null,
        error: { message: 'loyalty_reward_inactive' },
      },
    });
    const response = await POST(
      loyaltyRequest({ discount_code: 'RDM-ABCDEF12' })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).details).toBe('loyalty_reward_inactive');
  });
  it('returns 400 discount_code_invalid for a non-discount loyalty type', async () => {
    await setupLoyaltyBridge({
      get_storefront_discount_code: { data: [], error: null },
      get_loyalty_redemption_for_checkout: {
        data: [
          {
            ...LOYALTY_CODE_ROW,
            reward_type: 'free_shipping',
            reward_value: null,
          },
        ],
        error: null,
      },
    });
    const response = await POST(
      loyaltyRequest({ discount_code: 'RDM-ABCDEF12' })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('discount_code_invalid');
  });
});
