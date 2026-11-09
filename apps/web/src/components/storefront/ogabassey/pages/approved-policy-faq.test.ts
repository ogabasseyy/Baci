import { describe, expect, it } from 'vitest';
import {
  OGABASSEY_RETURN_POLICY_SUMMARY,
  OGABASSEY_WARRANTY_POLICY_SUMMARY,
} from '@/lib/storefront-trust/ogabassey-approved-policy';
import {
  applyApprovedPolicyFaqs,
  FALLBACK_HELP_FAQS,
} from './approved-policy-faq';

describe('approved policy FAQs', () => {
  const stale = [
    { question: 'What is your return policy?', answer: '7 days' },
    { question: 'How does the warranty work?', answer: '3 months used' },
    { question: 'How do I track an order?', answer: 'My Orders' },
  ];
  it('uses the same approved answers for saved FAQ content and schema', () => {
    expect(
      applyApprovedPolicyFaqs(stale, 'ogabassey').map(({ answer }) => answer)
    ).toEqual([
      OGABASSEY_RETURN_POLICY_SUMMARY,
      OGABASSEY_WARRANTY_POLICY_SUMMARY,
      'My Orders',
    ]);
  });
  it('preserves another merchant even when using the template', () => {
    expect(applyApprovedPolicyFaqs(stale, 'other')).toBe(stale);
    expect(applyApprovedPolicyFaqs(stale)).toBe(stale);
  });
  it('applies Ogabassey installment and swap answers when slug is ogabassey', () => {
    const faqs = [
      { question: 'Do you offer installment payments?', answer: 'neutral' },
      { question: 'Can I swap my old phone?', answer: 'neutral' },
    ];
    const result = applyApprovedPolicyFaqs(faqs, 'ogabassey');
    expect(result[0]?.answer).toContain('Buy Now, Pay Later');
    expect(result[1]?.answer).toContain('Swap & Trade-in');
  });
  it('preserves neutral installment and swap answers for other merchants', () => {
    const faqs = [
      {
        question: 'Do you offer installment payments?',
        answer: 'neutral payment',
      },
      { question: 'Can I swap my old phone?', answer: 'neutral swap' },
    ];
    const result = applyApprovedPolicyFaqs(faqs, 'other');
    expect(result).toBe(faqs);
  });
  it('provides neutral default installment and swap answers in FALLBACK_HELP_FAQS', () => {
    const installment = FALLBACK_HELP_FAQS.find((item) =>
      item.question.toLowerCase().includes('installment')
    );
    expect(installment?.answer).not.toContain('Buy Now, Pay Later');
    expect(installment?.answer).toContain('Available payment options');

    const swap = FALLBACK_HELP_FAQS.find((item) =>
      item.question.toLowerCase().includes('swap')
    );
    expect(swap?.answer).not.toContain('Swap & Trade-in');
    expect(swap?.answer).toContain('trade-in or swap options');
  });
  it('preserves specific warranty, Assurance, claims and payment return questions', () => {
    const specific = [
      {
        question: 'Does the warranty cover accidental damage?',
        answer: 'See the damage exclusions.',
      },
      {
        question: 'Is my warranty void if I repair the phone?',
        answer: 'Contact support about the repair.',
      },
      {
        question: 'Can I extend the warranty?',
        answer: 'Ask about separate plans.',
      },
      {
        question: 'How do I make a warranty claim?',
        answer: 'Send your order reference to support.',
      },
      {
        question: 'What is the Ogabassey Assurance warranty plan?',
        answer: 'Separate protection plan terms apply.',
      },
      {
        question: 'What is your return policy for failed payment refunds?',
        answer: 'Contact payments support.',
      },
    ];
    const result = applyApprovedPolicyFaqs(specific, 'ogabassey');
    expect(result).toEqual(specific);
    result.forEach((faq, index) => expect(faq).toBe(specific[index]));
  });
  it('recognizes canonical questions with normalized case, punctuation and whitespace', () => {
    const result = applyApprovedPolicyFaqs(
      [
        { question: '  WHAT  IS YOUR RETURN POLICY ?  ', answer: 'stale' },
        { question: 'What is the return policy.', answer: 'stale' },
        { question: ' HOW DOES THE WARRANTY WORK? ', answer: 'stale' },
        { question: 'How does your warranty work', answer: 'stale' },
      ],
      'ogabassey'
    );
    expect(result.map(({ answer }) => answer)).toEqual([
      OGABASSEY_RETURN_POLICY_SUMMARY,
      OGABASSEY_RETURN_POLICY_SUMMARY,
      OGABASSEY_WARRANTY_POLICY_SUMMARY,
      OGABASSEY_WARRANTY_POLICY_SUMMARY,
    ]);
  });
});
