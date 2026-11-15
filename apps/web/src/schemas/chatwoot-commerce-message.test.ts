import { describe, expect, it } from 'vitest';
import { chatwootCommerceMessageSchema } from './chatwoot-commerce-message';

describe('Chatwoot commerce message schemas', () => {
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
