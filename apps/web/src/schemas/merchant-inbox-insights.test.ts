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

const full = {
  conversations_count: 12,
  incoming_messages_count: '40',
  outgoing_messages_count: 30,
  resolutions_count: 5,
  avg_first_response_time: '95.6',
  avg_resolution_time: null,
};

describe('providerInboxSummarySchema', () => {
  it('reads numbers and numeric strings, with null times as no data', () => {
    expect(providerInboxSummarySchema.parse(full)).toEqual({
      conversations_count: 12,
      incoming_messages_count: 40,
      outgoing_messages_count: 30,
      resolutions_count: 5,
      avg_first_response_time: 96,
      avg_resolution_time: null,
    });
  });
  it('treats negative or garbage values as no data', () => {
    const parsed = providerInboxSummarySchema.parse({
      ...full,
      conversations_count: -3,
      avg_first_response_time: 'abc',
    });
    expect(parsed.conversations_count).toBe(0);
    expect(parsed.avg_first_response_time).toBeNull();
  });
  it('rejects a payload missing a key instead of reading it as zero', () => {
    const { resolutions_count: _dropped, ...renamed } = full;
    expect(
      providerInboxSummarySchema.safeParse({
        ...renamed,
        resolved_conversations_count: 5,
      }).success
    ).toBe(false);
  });
});
