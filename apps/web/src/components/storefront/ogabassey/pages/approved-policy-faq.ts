import {
  OGABASSEY_RETURN_POLICY_SUMMARY,
  OGABASSEY_WARRANTY_POLICY_SUMMARY,
} from '@/lib/storefront-trust/ogabassey-approved-policy';

export interface FaqItem {
  question: string;
  answer: string;
}

export const FALLBACK_HELP_FAQS: FaqItem[] = [
  {
    question: 'How do I track my order?',
    answer:
      "You can track your order by visiting the 'My Orders' section in your profile. Click on the specific order to see real-time status updates and tracking numbers if available.",
  },
  {
    question: 'What is your return policy?',
    answer: 'Contact customer support to confirm return eligibility, timing, method and any fees before sending an item back.',
  },
  {
    question: 'How does the warranty work?',
    answer: 'Contact customer support before purchase to confirm warranty coverage, exclusions and the claim process for your device.',
  },
  {
    question: 'Do you offer installment payments?',
    answer:
      "Yes, we partner with selected financial institutions to offer 'Buy Now, Pay Later' options. You can select this option at checkout if you are eligible.",
  },
  {
    question: 'Can I swap my old phone?',
    answer:
      "Absolutely! Use our 'Swap & Trade-in' feature to get an estimated value for your current device. You can use this value as a discount towards your new purchase.",
  },
];

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
