import {
  OGABASSEY_RETURN_POLICY_SUMMARY,
  OGABASSEY_WARRANTY_POLICY_SUMMARY,
} from '@/lib/storefront-trust/ogabassey-approved-policy';

export function applyApprovedPolicyFaqs<T extends { question: string; answer: string }>(
  faqs: T[],
  slug?: string
): T[] {
  if (slug !== 'ogabassey') return faqs;
  return faqs.map((faq) => {
    if (/return policy/i.test(faq.question)) {
      return { ...faq, answer: OGABASSEY_RETURN_POLICY_SUMMARY };
    }
    if (/warranty/i.test(faq.question)) {
      return { ...faq, answer: OGABASSEY_WARRANTY_POLICY_SUMMARY };
    }
    return faq;
  });
}
