import { describe, expect, it } from 'vitest';
import { getCartHandoffUrl } from './cart-handoff-result';

describe('getCartHandoffUrl', () => {
  it('accepts a successful Ogabassey cart handoff', () => {
    expect(getCartHandoffUrl({
      structuredContent: {
        success: true,
        cart_url: 'https://ogabassey.com/cart?item_id=phone-1&qty=1',
      },
    }, 'phone-1')).toBe('https://ogabassey.com/cart?item_id=phone-1&qty=1');
  });

  it('rejects failures and off-site URLs', () => {
    expect(getCartHandoffUrl({ structuredContent: { success: false } }, 'phone-1')).toBeNull();
    expect(getCartHandoffUrl({
      structuredContent: { success: true, cart_url: 'https://example.com/cart' },
    }, 'phone-1')).toBeNull();
    expect(getCartHandoffUrl({
      structuredContent: { success: true, cart_url: 'https://ogabassey.com/cart?item_id=phone-2' },
    }, 'phone-1')).toBeNull();
    expect(getCartHandoffUrl(undefined, 'phone-1')).toBeNull();
  });
});
