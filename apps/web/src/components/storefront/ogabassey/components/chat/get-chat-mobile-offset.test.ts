import { describe, expect, it } from 'vitest';
import { getChatMobileOffset } from './get-chat-mobile-offset';

describe('getChatMobileOffset', () => {
  it.each([
    [null, 'default'],
    ['/ogabassey', 'default'],
    ['/store/cart', 'cart'],
    ['/store/category/product', 'product'],
    ['/store/category/cart-organizer', 'product'],
    ['/store/checkout/payment', 'default'],
  ] as const)('reserves the correct mobile controls for %s', (path, expected) => {
    expect(getChatMobileOffset(path)).toBe(expected);
  });
});
