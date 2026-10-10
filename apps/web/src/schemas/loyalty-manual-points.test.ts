import { describe, expect, it } from 'vitest';
import { loyaltyManualPointsSchema } from './loyalty-manual-points';

const CUSTOMER_ID = '01aa0000-0000-4000-8000-000000000011';

describe('loyaltyManualPointsSchema', () => {
  it('accepts a UUID customer with non-zero integer points', () => {
    const parsed = loyaltyManualPointsSchema.safeParse({
      customerId: CUSTOMER_ID,
      points: 200,
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe('adjust');
    }
  });

  it('accepts negative integer points for deductions', () => {
    const parsed = loyaltyManualPointsSchema.safeParse({
      customerId: CUSTOMER_ID,
      points: -50,
      reason: 'Goodwill correction',
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects non-UUID customers', () => {
    expect(
      loyaltyManualPointsSchema.safeParse({
        customerId: 'not-a-uuid',
        points: 200,
      }).success
    ).toBe(false);
  });

  it('rejects fractional and zero points', () => {
    expect(
      loyaltyManualPointsSchema.safeParse({
        customerId: CUSTOMER_ID,
        points: 10.5,
      }).success
    ).toBe(false);
    expect(
      loyaltyManualPointsSchema.safeParse({
        customerId: CUSTOMER_ID,
        points: 0,
      }).success
    ).toBe(false);
  });

  it('bounds adjustments to the signed 32-bit range', () => {
    expect(
      loyaltyManualPointsSchema.safeParse({
        customerId: CUSTOMER_ID,
        points: 2 ** 31,
      }).success
    ).toBe(false);
    expect(
      loyaltyManualPointsSchema.safeParse({
        customerId: CUSTOMER_ID,
        points: -(2 ** 31) - 1,
      }).success
    ).toBe(false);
    expect(
      loyaltyManualPointsSchema.safeParse({
        customerId: CUSTOMER_ID,
        points: 2 ** 31 - 1,
      }).success
    ).toBe(true);
  });

  it('rejects forged transaction types and overlong reasons', () => {
    expect(
      loyaltyManualPointsSchema.safeParse({
        customerId: CUSTOMER_ID,
        points: 200,
        type: 'earn',
      }).success
    ).toBe(false);
    expect(
      loyaltyManualPointsSchema.safeParse({
        customerId: CUSTOMER_ID,
        points: 200,
        reason: 'x'.repeat(501),
      }).success
    ).toBe(false);
  });
});
