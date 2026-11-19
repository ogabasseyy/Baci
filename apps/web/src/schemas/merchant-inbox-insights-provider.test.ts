import { describe, expect, it } from 'vitest';
import { providerInboxSummarySchema } from './merchant-inbox-insights-provider';

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
  it('treats junk time values as no data', () => {
    const parsed = providerInboxSummarySchema.parse({
      ...full,
      avg_first_response_time: 'abc',
    });
    expect(parsed.avg_first_response_time).toBeNull();
  });
  it.each([
    -3,
    'abc',
    '',
  ])('rejects a corrupt count (%s) instead of showing zero', (bad) => {
    expect(
      providerInboxSummarySchema.safeParse({
        ...full,
        conversations_count: bad,
      }).success
    ).toBe(false);
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
