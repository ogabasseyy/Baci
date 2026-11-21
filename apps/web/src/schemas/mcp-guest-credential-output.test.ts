import { describe, expect, it } from 'vitest';
import { mcpGuestCredentialOutputSchema } from './mcp-guest-credential-output';

const id = '11111111-1111-4111-8111-111111111111';

describe('mcpGuestCredentialOutputSchema', () => {
  const cart = {
    success: true,
    cartCredential: 'A'.repeat(43),
    items: [{ product_id: id, quantity: 1 }],
    expires_at: '2026-11-21T09:00:00.000Z',
    cart_url: 'https://ogabassey.com/cart',
  };

  it.each([
    'cartCredential',
    'items',
    'expires_at',
    'cart_url',
  ] as const)('requires %s when the tool reports success', (key) => {
    expect(
      mcpGuestCredentialOutputSchema.safeParse({ ...cart, [key]: undefined })
        .success
    ).toBe(false);
  });

  it('accepts complete state or a minimal failure', () => {
    expect(mcpGuestCredentialOutputSchema.safeParse(cart).success).toBe(true);
    expect(
      mcpGuestCredentialOutputSchema.safeParse({ success: false }).success
    ).toBe(true);
  });
});
