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

  it('accepts a bound delivery estimate request and rejects extra data', () => {
    const valid = {
      event: 'baci-delivery-options-request',
      data: {
        requestId: 'delivery-001',
        conversationId: 905,
        sessionToken: 'signed-session-capability',
        state: 'Lagos',
      },
    };
    expect(chatwootCommerceMessageSchema.safeParse(valid).success).toBe(true);
    expect(
      chatwootCommerceMessageSchema.safeParse({
        ...valid,
        data: { ...valid.data, address: 'Private Street' },
      }).success
    ).toBe(false);
  });
});
