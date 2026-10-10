import { describe, expect, it } from 'vitest';
import {
  storefrontLoyaltyStatusQuerySchema,
  storefrontLoyaltyStatusResultSchema,
} from './storefront-loyalty-status';

const MERCHANT_ID = '01aa0000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '01aa0000-0000-4000-8000-000000000011';

describe('storefrontLoyaltyStatusQuerySchema', () => {
  it('accepts UUID query params', () => {
    const parsed = storefrontLoyaltyStatusQuerySchema.safeParse({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects non-UUID ids', () => {
    const parsed = storefrontLoyaltyStatusQuerySchema.safeParse({
      merchant_id: 'not-a-uuid',
      customer_id: CUSTOMER_ID,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('storefrontLoyaltyStatusResultSchema', () => {
  it('accepts a complete status payload', () => {
    const parsed = storefrontLoyaltyStatusResultSchema.safeParse({
      success: true,
      enrolled: true,
      points_balance: 150,
      lifetime_points: 500,
      current_tier: 'Bronze',
      referral_code: 'ABCD1234',
      tiers: [
        { name: 'Bronze', minPoints: 0 },
        { name: 'Silver', minPoints: 1000 },
      ],
      signup_bonus_points: 50,
      referral_bonus_points: 100,
      points_per_currency: 1,
      points_currency_unit: 100,
      rewards: [
        {
          id: 'r1',
          name: 'Free shipping',
          description: null,
          points_cost: 200,
          reward_type: 'free_shipping',
          reward_value: null,
        },
      ],
      transactions: [
        {
          id: 't1',
          points: 50,
          type: 'bonus',
          description: 'Loyalty signup bonus',
          created_at: '2026-10-09T00:00:00.000Z',
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a mistyped status payload', () => {
    const parsed = storefrontLoyaltyStatusResultSchema.safeParse({
      success: true,
      enrolled: true,
      points_balance: 'plenty',
      lifetime_points: 500,
      current_tier: 'Bronze',
      tiers: [],
      signup_bonus_points: 50,
      referral_bonus_points: 100,
      points_per_currency: 1,
      points_currency_unit: 100,
      rewards: [],
      transactions: [],
    });
    expect(parsed.success).toBe(false);
  });
});
