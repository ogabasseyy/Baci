import { describe, expect, it } from 'vitest';
import { loyaltyRedemptionConsumeSchema } from './loyalty-redemption-consume';

describe('loyaltyRedemptionConsumeSchema', () => {
  it('accepts a presented code and trims it', () => {
    const result = loyaltyRedemptionConsumeSchema.safeParse({
      code: '  RDM-ABC123  ',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe('RDM-ABC123');
    }
  });

  it('rejects empty, missing, and non-string codes', () => {
    for (const body of [{ code: '' }, { code: '   ' }, {}, { code: 42 }]) {
      expect(loyaltyRedemptionConsumeSchema.safeParse(body).success).toBe(
        false
      );
    }
  });

  it('rejects non-object bodies', () => {
    for (const body of [null, [], 'RDM-ABC123']) {
      expect(loyaltyRedemptionConsumeSchema.safeParse(body).success).toBe(
        false
      );
    }
  });
});
