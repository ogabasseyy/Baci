import { describe, expect, it } from 'vitest';
import { mcpDeliveryFeeInfoInputSchema } from './mcp-delivery-fee-info';

describe('mcpDeliveryFeeInfoInputSchema', () => {
  it('accepts a state with an optional city and enforces the documented bounds', () => {
    expect(mcpDeliveryFeeInfoInputSchema.parse({ state: 'Lagos' })).toEqual({
      state: 'Lagos',
    });
    expect(
      mcpDeliveryFeeInfoInputSchema.parse({ state: 'Lagos', city: 'Ikeja' })
    ).toEqual({ state: 'Lagos', city: 'Ikeja' });
    expect(
      mcpDeliveryFeeInfoInputSchema.safeParse({ state: 'L' }).success
    ).toBe(false);
    expect(
      mcpDeliveryFeeInfoInputSchema.safeParse({ state: 'L'.repeat(51) }).success
    ).toBe(false);
    expect(
      mcpDeliveryFeeInfoInputSchema.safeParse({ state: 'Lagos', city: 'I' })
        .success
    ).toBe(false);
    expect(
      mcpDeliveryFeeInfoInputSchema.safeParse({
        state: 'Lagos',
        city: 'I'.repeat(101),
      }).success
    ).toBe(false);
  });
});
