import { type FAQItem, parseLegacyFAQ } from '@/types/faq';

export interface MerchantFaqSource {
  faq_items?: unknown;
  pages?: { faq?: string | null } | null;
}

function isFaqItemCandidate(value: unknown): value is FAQItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.question === 'string' &&
    item.question.trim().length > 0 &&
    typeof item.answer === 'string' &&
    item.answer.trim().length > 0
  );
}

/**
 * Extracts FAQ items from merchant data, checking both structured faq_items
 * and legacy FAQ content. Returns an empty array when no valid items exist.
 */
export function extractFaqItems(merchant: MerchantFaqSource): FAQItem[] {
  if (Array.isArray(merchant.faq_items)) {
    const valid = merchant.faq_items.filter(isFaqItemCandidate);
    if (valid.length > 0) {
      return valid;
    }
  }
  if (merchant.pages?.faq) {
    return parseLegacyFAQ(merchant.pages.faq).filter(isFaqItemCandidate);
  }
  return [];
}
