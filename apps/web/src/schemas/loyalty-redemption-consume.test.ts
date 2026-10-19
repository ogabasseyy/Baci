import { describe, expect, it } from 'vitest';
import { loyaltyRedemptionConsumeSchema } from './loyalty-redemption-consume';

describe('loyaltyRedemptionConsumeSchema', () => {
  it('accepts a presented code and trims it', () => {
    const result = loyaltyRedemptionConsumeSchema.safeParse({
      code: '  RDM-ABC123  ',
      idempotency_key: 'attempt-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe('RDM-ABC123');
    }
  });

  it('requires an attempt idempotency key', () => {
    // A keyless consume stamps NULL in the RPC, so its lost-response
    // retry is indistinguishable from a re-presentation.
    expect(
      loyaltyRedemptionConsumeSchema.safeParse({ code: 'RDM-ABC123' }).success
    ).toBe(false);
    const parsed = loyaltyRedemptionConsumeSchema.safeParse({
      code: 'RDM-ABC123',
      idempotency_key: 'attempt-9',
    });

    expect(parsed.success).toBe(true);
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
