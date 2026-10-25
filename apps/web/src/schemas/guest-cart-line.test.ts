import { describe, expect, it } from 'vitest';
import { guestCartLineSchema } from './guest-cart-line';

const id = '11111111-1111-4111-8111-111111111111';
describe('guestCartLineSchema', () => {
  it('keeps an exact offer id and rejects a non-uuid offer', () => {
    const offerId = '44444444-4444-4444-8444-444444444444';
    const parsed = guestCartLineSchema.safeParse({
      offer_id: offerId,
      product_id: id,
      quantity: 1,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.offer_id).toBe(offerId);
    expect(
      guestCartLineSchema.safeParse({
        offer_id: 'offer',
        product_id: id,
        quantity: 1,
      }).success
    ).toBe(false);
  });

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
