import { describe, expect, it } from 'vitest';
import { merchantInboxInsightsResponseSchema } from './merchant-inbox-insights-response';

const valid = {
  days: 7,
  conversations: 9,
  customerMessages: 31,
  storeReplies: 22,
  resolved: 6,
  avgFirstResponseSeconds: 720,
  avgResolutionSeconds: null,
};

describe('merchantInboxInsightsResponseSchema', () => {
  it('accepts a full response with a null average', () => {
    expect(merchantInboxInsightsResponseSchema.parse(valid)).toEqual(valid);
  });
  it.each([7, 30, 90])('accepts the %s day window', (days) => {
    expect(
      merchantInboxInsightsResponseSchema.safeParse({ ...valid, days }).success
    ).toBe(true);
  });
  it.each([0, 14, 365])('rejects the %s day window', (days) => {
    expect(
      merchantInboxInsightsResponseSchema.safeParse({ ...valid, days }).success
    ).toBe(false);
  });
  it.each([
    ['conversations', -1],
    ['customerMessages', 1.5],
    ['storeReplies', -2],
    ['resolved', 0.5],
    ['avgFirstResponseSeconds', 45.6],
    ['avgResolutionSeconds', -1],
  ])('rejects %s = %s', (field, value) => {
    expect(
      merchantInboxInsightsResponseSchema.safeParse({
        ...valid,
        [field]: value,
      }).success
    ).toBe(false);
  });
  it('accepts zero counts', () => {
    expect(
      merchantInboxInsightsResponseSchema.safeParse({
        ...valid,
        conversations: 0,
        resolved: 0,
      }).success
    ).toBe(true);
  });
  it('requires every field', () => {
    const { storeReplies: _omit, ...missing } = valid;
    expect(merchantInboxInsightsResponseSchema.safeParse(missing).success).toBe(
      false
    );
  });
});
