import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImmediateNotificationCompletionProof } from './notification-completion-proof';

const SECRET = 'test-completion-secret-32-chars-min!';

describe('createImmediateNotificationCompletionProof', () => {
  beforeEach(() => {
    vi.stubEnv('IMMEDIATE_NOTIFICATION_COMPLETION_HMAC_SECRET', SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('matches the SQL verifier payload order (order|lease|outcome)', () => {
    // Vectors computed independently (openssl dgst -hmac): the payload
    // join order must mirror the SQL concat_ws exactly or every
    // proof-bound completion no-ops.
    expect(
      createImmediateNotificationCompletionProof({
        orderId: 'order-1',
        claimToken: 'lease-1',
        sent: true,
      })
    ).toBe('15c2a6cb3ba7133afe158c2818e88d6b7b5780fbb670712afe83ceda4b32d3e6');
    expect(
      createImmediateNotificationCompletionProof({
        orderId: 'order-1',
        claimToken: 'lease-1',
        sent: false,
      })
    ).toBe('ae586ae342c359a1e2c6b1e76f141cb944940a461b5eb59c24ae3f7f2ea52230');
  });

  it('throws when the server secret is unconfigured', () => {
    vi.stubEnv('IMMEDIATE_NOTIFICATION_COMPLETION_HMAC_SECRET', '');
    expect(() =>
      createImmediateNotificationCompletionProof({
        orderId: 'order-1',
        claimToken: 'lease-1',
        sent: true,
      })
    ).toThrow('IMMEDIATE_NOTIFICATION_COMPLETION_HMAC_SECRET');
  });
});
