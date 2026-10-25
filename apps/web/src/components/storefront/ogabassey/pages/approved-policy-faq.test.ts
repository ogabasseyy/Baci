import { describe, expect, it } from 'vitest';
import { applyApprovedPolicyFaqs } from './approved-policy-faq';
import { OGABASSEY_RETURN_POLICY_SUMMARY, OGABASSEY_WARRANTY_POLICY_SUMMARY } from '@/lib/storefront-trust/ogabassey-approved-policy';

describe('approved policy FAQs', () => {
  const stale = [
    { question: 'What is your return policy?', answer: '7 days' },
    { question: 'How does the warranty work?', answer: '3 months used' },
    { question: 'How do I track an order?', answer: 'My Orders' },
  ];
  it('uses the same approved answers for saved FAQ content and schema', () => {
    expect(applyApprovedPolicyFaqs(stale, 'ogabassey').map(({ answer }) => answer)).toEqual([
      OGABASSEY_RETURN_POLICY_SUMMARY, OGABASSEY_WARRANTY_POLICY_SUMMARY, 'My Orders',
    ]);
  });
  it('preserves another merchant even when using the template', () => {
    expect(applyApprovedPolicyFaqs(stale, 'other')).toBe(stale);
    expect(applyApprovedPolicyFaqs(stale)).toBe(stale);
  });
});
