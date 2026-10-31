// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cartResponse } from './ucp-conformance-cart-response';
import { LINE_MINOR } from './ucp-conformance-data';

describe('UCP conformance cart response', () => {
  it('builds a cart with one line of two units totalling the line amount', () => {
    const cart = cartResponse();

    expect(cart.currency).toBe('NGN');
    expect(cart.line_items).toHaveLength(1);
    expect(cart.line_items[0].quantity).toBe(2);
    expect(cart.totals.find((total) => total.type === 'total')?.amount).toBe(
      LINE_MINOR
    );
  });

  it('returns the same inputs on every call', () => {
    expect(cartResponse()).toEqual(cartResponse());
  });
});
