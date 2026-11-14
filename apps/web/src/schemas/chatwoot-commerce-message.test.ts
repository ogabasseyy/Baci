import { describe, expect, it } from 'vitest';
import { chatwootCommerceMessageSchema } from './chatwoot-commerce-message';

describe('Chatwoot commerce message schemas', () => {
  it('allows simple catalog adds without a variant id', () => {
    expect(
      chatwootCommerceMessageSchema.safeParse({
        event: 'baci-cart-add',
        data: {
          slug: 'simple-product',
          displayedPrice: 10,
          requestId: 'add-request-1',
          conversationId: 905,
          sessionToken: 'signed-session-token',
        },
      }).success
    ).toBe(true);
  });

  it('rejects unsafe cart versions on quantity messages', () => {
    expect(
      chatwootCommerceMessageSchema.safeParse({
        event: 'baci-cart-quantity',
        data: {
          requestId: 'quantity-0001',
          conversationId: 905,
          sessionToken: 'signed-session-token',
          lineToken: 'opaque-line-token',
          cartVersion: Number.MAX_SAFE_INTEGER + 1,
          expectedQuantity: 2,
          quantity: 3,
        },
      }).success
    ).toBe(false);
  });

  it('keeps commerce messages strict and accepts supported session token sizes', () => {
    const parsed = chatwootCommerceMessageSchema.safeParse({
      event: 'baci-cart-request',
      data: {
        requestId: 'request-1',
        conversationId: 905,
        sessionToken: 't'.repeat(12_000),
      },
    });
    expect(parsed.success).toBe(true);
    expect(
      chatwootCommerceMessageSchema.safeParse({
        event: 'baci-cart-request',
        data: {
          requestId: 'request-1',
          conversationId: 905,
          sessionToken: 'token',
          merchantId: 'caller-selected',
        },
      }).success
    ).toBe(false);
  });
});
