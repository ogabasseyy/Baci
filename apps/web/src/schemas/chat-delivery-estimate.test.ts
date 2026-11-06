import { describe, expect, it } from 'vitest';
import { chatDeliveryEstimateRequestSchema } from './chat-delivery-estimate';

describe('chatDeliveryEstimateRequestSchema', () => {
  it('accepts a valid state and trims surrounding whitespace', () => {
    expect(
      chatDeliveryEstimateRequestSchema.parse({ state: ' Lagos ' })
    ).toEqual({
      state: 'Lagos',
    });
  });

  it('requires state to be a string', () => {
    expect(chatDeliveryEstimateRequestSchema.safeParse({}).success).toBe(false);
    expect(
      chatDeliveryEstimateRequestSchema.safeParse({ state: 42 }).success
    ).toBe(false);
  });

  it('enforces the minimum and maximum state lengths', () => {
    expect(
      chatDeliveryEstimateRequestSchema.safeParse({ state: 'A' }).success
    ).toBe(false);
    expect(
      chatDeliveryEstimateRequestSchema.safeParse({ state: 'A'.repeat(101) })
        .success
    ).toBe(false);
    expect(
      chatDeliveryEstimateRequestSchema.safeParse({ state: 'A'.repeat(100) })
        .success
    ).toBe(true);
  });

  it('rejects unknown request fields', () => {
    expect(
      chatDeliveryEstimateRequestSchema.safeParse({
        state: 'Lagos',
        merchantId: 'forged-merchant',
      }).success
    ).toBe(false);
  });
});
