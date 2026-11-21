import { expect, it } from 'vitest';
import { mcpGuestCartOutputBase } from './mcp-guest-cart-output-base';

it('preserves typed recovery flags on unsuccessful replies', () => {
  expect(
    mcpGuestCartOutputBase.parse({ success: false, cart_expired: true })
  ).toEqual({
    success: false,
    cart_expired: true,
  });
  expect(mcpGuestCartOutputBase.safeParse({ success: 'false' }).success).toBe(
    false
  );
});
