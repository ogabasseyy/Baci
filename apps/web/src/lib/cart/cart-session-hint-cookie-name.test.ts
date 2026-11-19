import { describe, expect, it } from 'vitest';
import { cartSessionHintCookieName } from './cart-session-hint-cookie-name';

describe('cartSessionHintCookieName', () => {
  it('normalizes whitespace and case per merchant identifier', () => {
    expect(cartSessionHintCookieName('  Merchant-ABC  ')).toBe(
      'baci-cart-hint-merchant-abc'
    );
  });
});
