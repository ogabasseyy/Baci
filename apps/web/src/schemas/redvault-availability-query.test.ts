import { describe, expect, it } from 'vitest';
import { redvaultAvailabilityQuerySchema } from './redvault-availability-query';

describe('redvaultAvailabilityQuerySchema', () => {
  it('accepts a UUID merchant identifier', () => {
    expect(
      redvaultAvailabilityQuerySchema.safeParse({
        merchant_id: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      }).success
    ).toBe(true);
  });

  it('rejects malformed merchant identifiers', () => {
    expect(
      redvaultAvailabilityQuerySchema.safeParse({ merchant_id: 'not-a-uuid' })
        .success
    ).toBe(false);
  });

  it('accepts an optional product UUID for private pilot visibility', () => {
    expect(
      redvaultAvailabilityQuerySchema.safeParse({
        merchant_id: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        product_id: '11111111-1111-4111-8111-111111111111',
      }).success
    ).toBe(true);
  });

  it('rejects malformed optional product identifiers', () => {
    expect(
      redvaultAvailabilityQuerySchema.safeParse({
        merchant_id: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        product_id: 'not-a-uuid',
      }).success
    ).toBe(false);
  });
});
