import { describe, expect, it } from 'vitest';
import { storedCartSchema } from './guest-cart-stored-cart';

const id = '11111111-1111-4111-8111-111111111111';

function line(productId: string, quantity = 1) {
  return { product_id: productId, quantity };
}

describe('storedCartSchema', () => {
  it('parses a valid stored cart', () => {
    expect(
      storedCartSchema.safeParse({
        expires_at: Date.now() + 1000,
        items: [line(id, 2)],
      }).success
    ).toBe(true);
  });

  it('parses an empty-items cart', () => {
    expect(
      storedCartSchema.safeParse({ expires_at: 1, items: [] }).success
    ).toBe(true);
  });

  it.each([
    '2026-01-01',
    null,
    undefined,
    Number.NaN,
  ])('rejects a non-numeric expiry %s', (expires_at) => {
    expect(storedCartSchema.safeParse({ expires_at, items: [] }).success).toBe(
      false
    );
  });

  it('accepts exactly 20 lines', () => {
    const items = Array.from({ length: 20 }, (_, index) =>
      line(`33333333-3333-4333-8333-${index.toString(16).padStart(12, '0')}`)
    );
    expect(storedCartSchema.safeParse({ expires_at: 1, items }).success).toBe(
      true
    );
  });

  it('rejects a 21st line', () => {
    const items = Array.from({ length: 21 }, (_, index) =>
      line(`33333333-3333-4333-8333-${index.toString(16).padStart(12, '0')}`)
    );
    expect(storedCartSchema.safeParse({ expires_at: 1, items }).success).toBe(
      false
    );
  });

  it('rejects an invalid embedded line', () => {
    expect(
      storedCartSchema.safeParse({
        expires_at: 1,
        items: [{ product_id: 'not-a-uuid', quantity: 1 }],
      }).success
    ).toBe(false);
  });
});
