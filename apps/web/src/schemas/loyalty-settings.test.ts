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

  it('rejects non-object bodies', () => {
    for (const body of [null, [], 'settings']) {
      expect(loyaltySettingsPostSchema.safeParse(body).success).toBe(false);
    }
  });
});
