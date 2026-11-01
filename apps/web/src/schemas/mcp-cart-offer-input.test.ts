import { describe, expect, it } from 'vitest';
import { guestOAuthCartInputSchema } from './guest-oauth';
import { mcpGuestCartInputSchema } from './mcp-guest-cart';

const product = '11111111-1111-4111-8111-111111111111';
const offer = '55555555-5555-4555-8555-555555555555';
describe.each([
  mcpGuestCartInputSchema,
  guestOAuthCartInputSchema,
])('MCP cart offer identity', (schema) => {
  it('preserves a valid offer ID while retaining product-only compatibility', () => {
    const parsed = schema.parse({
      product_id: product,
      offer_id: offer,
      quantity: 1,
    });
    expect(parsed).toMatchObject({ product_id: product, offer_id: offer });
    expect(schema.safeParse({ product_id: product, quantity: 1 }).success).toBe(
      true
    );
  });
  it('rejects a malformed offer ID', () => {
    expect(
      schema.safeParse({ product_id: product, offer_id: 'bad' }).success
    ).toBe(false);
  });
});
