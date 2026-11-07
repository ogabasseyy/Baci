import { describe, expect, it } from 'vitest';
import {
  chatwootCommerceContextControlSchema,
  chatwootCommerceMessageSchema,
} from './chatwoot-commerce-message';

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

  it('requires validated visitor and context claims in control messages', () => {
    expect(
      chatwootCommerceContextControlSchema.safeParse({
        event: 'baci-commerce-context-request',
        data: {
          requestId: 'context_123456',
          conversationId: 905,
          websiteToken: 'synthetic-widget-token-123456',
          visitorTokenSha256: 'a'.repeat(64),
        },
      }).success
    ).toBe(true);
    expect(
      chatwootCommerceContextControlSchema.safeParse({
        event: 'baci-commerce-context-request',
        data: {
          requestId: 'context_123456',
          conversationId: 905,
          websiteToken: 'synthetic-widget-token-123456',
          visitorTokenSha256: 'A'.repeat(64),
        },
      }).success
    ).toBe(false);
  });
});
