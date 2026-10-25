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
  it('preserves specific warranty, Assurance, claims and payment return questions', () => {
    const specific = [
      { question: 'Does the warranty cover accidental damage?', answer: 'See the damage exclusions.' },
      { question: 'Is my warranty void if I repair the phone?', answer: 'Contact support about the repair.' },
      { question: 'Can I extend the warranty?', answer: 'Ask about separate plans.' },
      { question: 'How do I make a warranty claim?', answer: 'Send your order reference to support.' },
      { question: 'What is the Ogabassey Assurance warranty plan?', answer: 'Separate protection plan terms apply.' },
      { question: 'What is your return policy for failed payment refunds?', answer: 'Contact payments support.' },
    ];
    const result = applyApprovedPolicyFaqs(specific, 'ogabassey');
    expect(result).toEqual(specific);
    result.forEach((faq, index) => expect(faq).toBe(specific[index]));
  });
  it('recognizes canonical questions with normalized case, punctuation and whitespace', () => {
    const result = applyApprovedPolicyFaqs([
      { question: '  WHAT  IS YOUR RETURN POLICY ?  ', answer: 'stale' },
      { question: 'What is the return policy.', answer: 'stale' },
      { question: ' HOW DOES THE WARRANTY WORK? ', answer: 'stale' },
      { question: 'How does your warranty work', answer: 'stale' },
    ], 'ogabassey');
    expect(result.map(({ answer }) => answer)).toEqual([
      OGABASSEY_RETURN_POLICY_SUMMARY, OGABASSEY_RETURN_POLICY_SUMMARY,
      OGABASSEY_WARRANTY_POLICY_SUMMARY, OGABASSEY_WARRANTY_POLICY_SUMMARY,
    ]);
  });

});
