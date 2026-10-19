import { describe, expect, it } from 'vitest';
import { guestCartLineSchema } from './guest-cart-line';

const id = '11111111-1111-4111-8111-111111111111';
describe('guestCartLineSchema', () => {
  it('parses a valid line', () => {
    expect(
      guestCartLineSchema.safeParse({ product_id: id, quantity: 2 }).success
    ).toBe(true);
  });

  it('rejects a non-uuid product id', () => {
    expect(
      guestCartLineSchema.safeParse({ product_id: 'not-a-uuid', quantity: 2 })
        .success
    ).toBe(false);
  });

  it.each([1, 10])('accepts boundary quantity %i', (quantity) => {
    expect(
      guestCartLineSchema.safeParse({ product_id: id, quantity }).success
    ).toBe(true);
  });

  it.each([0, 11, 2.5])('rejects out-of-range quantity %s', (quantity) => {
    expect(
      guestCartLineSchema.safeParse({ product_id: id, quantity }).success
    ).toBe(false);
  });
});
