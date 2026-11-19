import { describe, expect, it } from 'vitest';
import { giglWebhookExpediteResultSchema } from './gigl-webhook-expedite-result';

describe('giglWebhookExpediteResultSchema', () => {
  it('accepts the RPC counts', () => {
    expect(
      giglWebhookExpediteResultSchema.parse({ matched: 1, expedited: 0 })
    ).toEqual({ matched: 1, expedited: 0 });
  });

  it('rejects negative or missing counts', () => {
    expect(
      giglWebhookExpediteResultSchema.safeParse({ matched: -1, expedited: 0 })
        .success
    ).toBe(false);
    expect(
      giglWebhookExpediteResultSchema.safeParse({ matched: 1 }).success
    ).toBe(false);
  });
});
