import { expect, it } from 'vitest';
import { mcpGuestCredentialUpdateInputSchema } from './mcp-guest-credential-update-input';

const product_id = '11111111-1111-4111-8111-111111111111';

it('defaults an add to one item and rejects the internal credential field', () => {
  expect(
    mcpGuestCredentialUpdateInputSchema.parse({ product_id }).quantity
  ).toBe(1);
  expect(
    mcpGuestCredentialUpdateInputSchema.safeParse({
      product_id,
      cart_token: '0'.repeat(64),
    }).success
  ).toBe(false);
});

it('accepts removal with or without a credential for the handler to check', () => {
  expect(
    mcpGuestCredentialUpdateInputSchema.safeParse({ product_id, quantity: 0 })
      .success
  ).toBe(true);
  expect(
    mcpGuestCredentialUpdateInputSchema.safeParse({
      product_id,
      quantity: 0,
      cartCredential: 'A'.repeat(43),
    }).success
  ).toBe(true);
});

it('rejects opting into a fresh cart on removal even with a credential', () => {
  expect(
    mcpGuestCredentialUpdateInputSchema.safeParse({
      product_id,
      quantity: 0,
      cartCredential: 'A'.repeat(43),
      startFreshIfUnavailable: true,
    }).success
  ).toBe(false);
});
