import { expect, it } from 'vitest';
import { mcpGuestCartReadInputSchema } from './mcp-guest-cart-read-input';

it('requires a model credential to read an existing cart', () => {
  expect(mcpGuestCartReadInputSchema.safeParse({}).success).toBe(false);
  expect(
    mcpGuestCartReadInputSchema.safeParse({ cartCredential: 'A'.repeat(43) })
      .success
  ).toBe(true);
});
