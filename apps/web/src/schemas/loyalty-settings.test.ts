import { describe, expect, it } from 'vitest';
import { loyaltySettingsPostSchema } from './loyalty-settings';

describe('loyaltySettingsPostSchema', () => {
  it('accepts an empty payload (every field defaults)', () => {
    expect(loyaltySettingsPostSchema.safeParse({}).success).toBe(true);
  });

  it('accepts null fields so the route can apply its defaults', () => {
    const result = loyaltySettingsPostSchema.safeParse({
      enabled: null,
      maximum_redemption_percentage: null,
    });

    expect(result.success).toBe(true);
  });

  it('accepts caps at the column-precision bounds', () => {
    for (const cap of [0.01, 50, 99.99, 100]) {
      expect(
        loyaltySettingsPostSchema.safeParse({
          maximum_redemption_percentage: cap,
        }).success
      ).toBe(true);
    }
  });

  it('rejects caps that round to zero or exceed two decimals', () => {
    for (const cap of [0, 0.001, 0.009, 50.001]) {
      expect(
        loyaltySettingsPostSchema.safeParse({
          maximum_redemption_percentage: cap,
        }).success
      ).toBe(false);
    }
  });

  it('rejects caps above 100 and non-number caps', () => {
    for (const cap of [100.01, '50', true]) {
      expect(
        loyaltySettingsPostSchema.safeParse({
          maximum_redemption_percentage: cap,
        }).success
      ).toBe(false);
    }
  });

  it('bounds integer point fields to int32 non-negative', () => {
    const fields = [
      'signup_bonus_points',
      'birthday_bonus_points',
      'review_bonus_points',
      'referral_bonus_points',
      'minimum_redemption_points',
      'points_expiry_days',
    ] as const;

    for (const field of fields) {
      for (const value of [0, 1, 500, 2 ** 31 - 1]) {
        expect(
          loyaltySettingsPostSchema.safeParse({ [field]: value }).success
        ).toBe(true);
      }
      for (const value of [10.5, -1, 2 ** 31, 1e20, '50']) {
        expect(
          loyaltySettingsPostSchema.safeParse({ [field]: value }).success
        ).toBe(false);
      }
    }
  });

  it('accepts a well-formed tier entry', () => {
    const parsed = loyaltySettingsPostSchema.safeParse({
      tiers: [
        {
          name: 'Gold',
          minPoints: 500,
          multiplier: 1.5,
          perks: ['Priority support'],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('normalizes legacy tier nulls instead of rejecting stored settings', () => {
    // Tiers persisted before this schema existed can carry null
    // multiplier/minPoints/perks; resubmitting them to save another
    // field must succeed with SQL-shaped defaults applied.
    const parsed = loyaltySettingsPostSchema.safeParse({
      tiers: [{ name: 'Gold', minPoints: null, multiplier: null, perks: null }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tiers).toEqual([
        { name: 'Gold', minPoints: 0, multiplier: undefined, perks: undefined },
      ]);
    }
  });

  it('rejects tier names that overflow the varchar(50) tier columns', () => {
    const parsed = loyaltySettingsPostSchema.safeParse({
      tiers: [{ name: 'x'.repeat(51), minPoints: 500 }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects malformed tier numeric fields', () => {
    expect(
      loyaltySettingsPostSchema.safeParse({
        tiers: [{ name: 'Gold', minPoints: -1 }],
      }).success
    ).toBe(false);
    expect(
      loyaltySettingsPostSchema.safeParse({
        tiers: [{ name: 'Gold', minPoints: 500, multiplier: -0.5 }],
      }).success
    ).toBe(false);
    expect(
      loyaltySettingsPostSchema.safeParse({
        tiers: [{ name: 'Gold', minPoints: 500, multiplier: 101 }],
      }).success
    ).toBe(false);
  });

  it('accepts earning rates at the column-precision bounds', () => {
    const parsed = loyaltySettingsPostSchema.safeParse({
      points_per_currency: 0.01,
      points_currency_unit: 99_999_999.99,
      points_to_currency_ratio: 0.0001,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects earning rates that round to zero in numeric(10,2)/(10,4)', () => {
    expect(
      loyaltySettingsPostSchema.safeParse({ points_currency_unit: 0.001 })
        .success
    ).toBe(false);
    expect(
      loyaltySettingsPostSchema.safeParse({ points_per_currency: 0 }).success
    ).toBe(false);
    expect(
      loyaltySettingsPostSchema.safeParse({
        points_to_currency_ratio: 0.00001,
      }).success
    ).toBe(false);
  });

  it('rejects earning rates beyond the columns or with excess precision', () => {
    expect(
      loyaltySettingsPostSchema.safeParse({ points_currency_unit: 1e20 })
        .success
    ).toBe(false);
    expect(
      loyaltySettingsPostSchema.safeParse({ points_per_currency: 1.005 })
        .success
    ).toBe(false);
    expect(
      loyaltySettingsPostSchema.safeParse({
        points_to_currency_ratio: 1_000_000,
      }).success
    ).toBe(false);
  });

  it('bounds program_name to the varchar(100) column', () => {
    expect(
      loyaltySettingsPostSchema.safeParse({ program_name: 'x'.repeat(100) })
        .success
    ).toBe(true);
    expect(
      loyaltySettingsPostSchema.safeParse({ program_name: 'x'.repeat(101) })
        .success
    ).toBe(false);
  });

  it('rejects non-object bodies', () => {
    for (const body of [null, [], 'settings']) {
      expect(loyaltySettingsPostSchema.safeParse(body).success).toBe(false);
    }
  });
});
