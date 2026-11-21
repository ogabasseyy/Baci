import { expect, it } from 'vitest';
import { mcpGuestCredentialUpdateInputSchema } from './mcp-guest-credential-update-input';

it('supports the first add and requires a model credential for removal', () => {
  const product_id = '11111111-1111-4111-8111-111111111111';
  expect(
    mcpGuestCredentialUpdateInputSchema.parse({ product_id }).quantity
  ).toBe(1);
  expect(
    mcpGuestCredentialUpdateInputSchema.safeParse({ product_id, quantity: 0 })
      .success
  ).toBe(false);
  expect(
    mcpGuestCredentialUpdateInputSchema.safeParse({
      product_id,
      quantity: 0,
      cartCredential: 'A'.repeat(43),
    }).success
  ).toBe(true);
  expect(
    mcpGuestCredentialUpdateInputSchema.safeParse({
      product_id,
      cart_token: '0'.repeat(64),
    }).success
  ).toBe(false);
});
