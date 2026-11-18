import { describe, expect, it } from 'vitest';
import { chatwootCommerceContextControlSchema } from './chatwoot-commerce-context-control';

describe('Chatwoot commerce context control schema', () => {
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
