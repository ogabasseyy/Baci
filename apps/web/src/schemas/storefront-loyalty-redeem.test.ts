import { describe, expect, it } from 'vitest';
import {
  storefrontLoyaltyRedeemResultSchema,
  storefrontLoyaltyRedeemSchema,
} from './storefront-loyalty-redeem';

describe('storefrontLoyaltyRedeemSchema', () => {
  it('accepts UUID ids', () => {
    const parsed = storefrontLoyaltyRedeemSchema.safeParse({
      merchant_id: '01aa0000-0000-4000-8000-000000000001',
      customer_id: '01aa0000-0000-4000-8000-000000000011',
      reward_id: '02aa0000-0000-4000-8000-000000000001',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects non-UUID ids', () => {
    const parsed = storefrontLoyaltyRedeemSchema.safeParse({
      merchant_id: 'not-a-uuid',
      customer_id: '01aa0000-0000-4000-8000-000000000011',
      reward_id: '02aa0000-0000-4000-8000-000000000001',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('storefrontLoyaltyRedeemResultSchema', () => {
  it('accepts a complete redemption payload', () => {
    const parsed = storefrontLoyaltyRedeemResultSchema.safeParse({
      success: true,
      redemption_code: 'RDM-ABC123',
      reward_name: 'Free shipping',
      reward_type: 'free_shipping',
      reward_value: null,
      points_spent: 200,
      new_balance: 1300,
      expires_at: '2026-11-09T00:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });
});
