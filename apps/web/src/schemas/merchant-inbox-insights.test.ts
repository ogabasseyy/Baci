import { describe, expect, it } from 'vitest';
import {
  merchantInboxInsightsQuerySchema,
  providerInboxSummarySchema,
} from './merchant-inbox-insights';

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

describe('providerInboxSummarySchema', () => {
  it('reads numbers and numeric strings, and treats missing data as empty', () => {
    const parsed = providerInboxSummarySchema.parse({
      conversations_count: 12,
      incoming_messages_count: '40',
      outgoing_messages_count: null,
      avg_first_response_time: '95.6',
      avg_resolution_time: null,
    });
    expect(parsed).toEqual({
      conversations_count: 12,
      incoming_messages_count: 40,
      outgoing_messages_count: 0,
      resolutions_count: 0,
      avg_first_response_time: 96,
      avg_resolution_time: null,
    });
  });
  it('treats negative or garbage values as no data', () => {
    const parsed = providerInboxSummarySchema.parse({
      conversations_count: -3,
      avg_first_response_time: 'abc',
    });
    expect(parsed.conversations_count).toBe(0);
    expect(parsed.avg_first_response_time).toBeNull();
  });
});
