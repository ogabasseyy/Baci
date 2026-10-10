import { describe, expect, it } from 'vitest';
import {
  storefrontLoyaltyEnrollResultSchema,
  storefrontLoyaltyEnrollSchema,
} from './storefront-loyalty-enroll';

const MERCHANT_ID = '01aa0000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '01aa0000-0000-4000-8000-000000000011';

describe('storefrontLoyaltyEnrollSchema', () => {
  it('accepts UUIDs with an optional referral code', () => {
    const parsed = storefrontLoyaltyEnrollSchema.safeParse({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      referral_code: 'ABCD1234',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts enrollment without a referral code', () => {
    const parsed = storefrontLoyaltyEnrollSchema.safeParse({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
    });
    expect(parsed.success).toBe(true);
  });

  it('trims the referral code', () => {
    const parsed = storefrontLoyaltyEnrollSchema.safeParse({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      referral_code: '  ABCD1234  ',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.referral_code).toBe('ABCD1234');
    }
  });

  it('rejects non-UUID ids', () => {
    const parsed = storefrontLoyaltyEnrollSchema.safeParse({
      merchant_id: 'not-a-uuid',
      customer_id: CUSTOMER_ID,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an overlong referral code', () => {
    const parsed = storefrontLoyaltyEnrollSchema.safeParse({
      merchant_id: MERCHANT_ID,
      customer_id: CUSTOMER_ID,
      referral_code: 'A'.repeat(21),
    });
    expect(parsed.success).toBe(false);
  });
});

describe('storefrontLoyaltyEnrollResultSchema', () => {
  it('accepts a complete success payload', () => {
    const parsed = storefrontLoyaltyEnrollResultSchema.safeParse({
      success: true,
      points_balance: 50,
      lifetime_points: 50,
      current_tier: 'Bronze',
      referral_code: 'ABCD1234',
      referral_bonus_applied: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a success payload with mistyped fields', () => {
    const parsed = storefrontLoyaltyEnrollResultSchema.safeParse({
      success: true,
      points_balance: 'fifty',
      current_tier: 'Bronze',
      referral_code: 'ABCD1234',
    });
    expect(parsed.success).toBe(false);
  });
});
