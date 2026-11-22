import { expect, it } from 'vitest';
import { mcpGuestCartInputBase } from './mcp-guest-cart-input-base';

it('defaults one unit and rejects a raw credential of the wrong size', () => {
  const product_id = '11111111-1111-4111-8111-111111111111';
  expect(mcpGuestCartInputBase.parse({ product_id }).quantity).toBe(1);
  expect(
    mcpGuestCartInputBase.safeParse({ product_id, cart_token: 'bad' }).success
  ).toBe(false);
});
