import { describe, expect, it } from 'vitest';
import { guestCartHandoffSchema } from './guest-cart-handoff';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
describe('guestCartHandoffSchema', () => {
  it('parses a valid handoff', () => {
    expect(
      guestCartHandoffSchema.safeParse([
        { product_id: id, quantity: 2 },
        { product_id: other, quantity: 1 },
      ]).success
    ).toBe(true);
  });

  it('rejects an empty handoff', () => {
    expect(guestCartHandoffSchema.safeParse([]).success).toBe(false);
  });

  it('rejects more than 20 lines', () => {
    const items = Array.from({ length: 21 }, (_, index) => ({
      product_id: `33333333-3333-4333-8333-${index.toString(16).padStart(12, '0')}`,
      quantity: 1,
    }));
    expect(guestCartHandoffSchema.safeParse(items).success).toBe(false);
  });

  it('rejects duplicate product ids', () => {
    expect(
      guestCartHandoffSchema.safeParse([
        { product_id: id, quantity: 1 },
        { product_id: id, quantity: 2 },
      ]).success
    ).toBe(false);
  });

  it('rejects duplicates that differ only by case', () => {
    expect(
      guestCartHandoffSchema.safeParse([
        { product_id: id.toUpperCase(), quantity: 1 },
        { product_id: id, quantity: 2 },
      ]).success
    ).toBe(false);
  });
});
