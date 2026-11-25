import { expect, it } from 'vitest';
import { mcpGuestCartReadInputSchema } from './mcp-guest-cart-read-input';

it('accepts a missing credential so the tool can explain that the cart is unavailable', () => {
  expect(mcpGuestCartReadInputSchema.safeParse({}).success).toBe(true);
  expect(
    mcpGuestCartReadInputSchema.safeParse({ cartCredential: 'A'.repeat(43) })
      .success
  ).toBe(true);
});
