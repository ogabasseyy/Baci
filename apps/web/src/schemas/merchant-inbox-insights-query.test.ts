import { describe, expect, it } from 'vitest';
import { merchantInboxInsightsQuerySchema } from './merchant-inbox-insights-query';

describe('merchantInboxInsightsQuerySchema', () => {
  it('defaults to 7 days', () => {
    expect(merchantInboxInsightsQuerySchema.parse({}).days).toBe(7);
  });
  it('accepts the offered windows and rejects others', () => {
    expect(merchantInboxInsightsQuerySchema.parse({ days: '30' }).days).toBe(
      30
    );
    expect(
      merchantInboxInsightsQuerySchema.safeParse({ days: '365' }).success
    ).toBe(false);
    expect(
      merchantInboxInsightsQuerySchema.safeParse({ days: 'x' }).success
    ).toBe(false);
  });
});
