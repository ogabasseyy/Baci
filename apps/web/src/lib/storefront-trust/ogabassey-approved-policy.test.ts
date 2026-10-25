import { describe, expect, it } from 'vitest';
import { buildOgabasseyApprovedPolicyDraft } from './ogabassey-approved-policy';

describe('approved policy draft isolation', () => {
  it('leaves the persisted draft untouched and preserves unrelated customer-service settings', () => {
    const draft = Object.freeze({
      founded_year: 2018,
      customer_service: Object.freeze({ hours_summary: 'Monday to Friday' }),
      return_policy: Object.freeze({ summary: 'Legacy terms', window_days: 7 }),
      shipping_policy: Object.freeze({
        summary: 'Legacy shipping',
        shipping_fee_type: 'free' as const,
        handling_days_min: 0,
        handling_days_max: 2,
      }),
    });
    const before = JSON.stringify(draft);
    const result = buildOgabasseyApprovedPolicyDraft({
      slug: 'ogabassey',
      trust_profile: draft,
    });
    expect(JSON.stringify(draft)).toBe(before);
    expect(result).not.toBe(draft);
    expect(result.customer_service).toEqual({
      hours_summary: 'Monday to Friday',
    });
    expect(result.founded_year).toBe(2018);
    expect(result.shipping_policy?.handling_days_max).toBe(2);
    expect(result.return_policy?.window_days).toBe(14);
    expect(result.shipping_policy?.shipping_fee_type).toBe('calculated');
  });

  it('does not inject a policy into another merchant with no persisted policy', () => {
    expect(
      buildOgabasseyApprovedPolicyDraft({ slug: 'another-store' })
    ).toEqual({});
  });
});
