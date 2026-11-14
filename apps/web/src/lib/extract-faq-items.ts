import { type FAQItem, parseLegacyFAQ } from '@/types/faq';

export interface MerchantFaqSource {
  faq_items?: unknown;
  pages?: { faq?: string | null } | null;
}

function hasVisibleText(value: string): boolean {
  return (
    value
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .trim().length > 0
  );
}

interface FaqItemCandidate {
  question: string;
  answer: string;
  id?: unknown;
  category?: unknown;
  order?: unknown;
}

function isFaqItemCandidate(value: unknown): value is FaqItemCandidate {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.question === 'string' &&
    hasVisibleText(item.question) &&
    typeof item.answer === 'string' &&
    hasVisibleText(item.answer)
  );
}

function normalizeFaqItem(item: FaqItemCandidate): FAQItem {
  const result: FAQItem = {
    question: item.question.trim(),
    answer: item.answer.trim(),
  };

  if (typeof item.id === 'string' && item.id.trim().length > 0) {
    result.id = item.id.trim();
  }

  if (typeof item.category === 'string' && item.category.trim().length > 0) {
    result.category = item.category.trim();
  }

  if (typeof item.order === 'number' && Number.isFinite(item.order)) {
    result.order = item.order;
  }

  return result;
}

/**
 * Extracts FAQ items from merchant data, checking both structured faq_items
 * and legacy FAQ content. Returns an empty array when no valid items exist.
 */
export function extractFaqItems(merchant: MerchantFaqSource): FAQItem[] {
  if (Array.isArray(merchant.faq_items)) {
    const valid = merchant.faq_items
      .filter(isFaqItemCandidate)
      .map(normalizeFaqItem);
    if (valid.length > 0) {
      return valid;
    }
  }
  if (merchant.pages?.faq) {
    return parseLegacyFAQ(merchant.pages.faq)
      .filter(isFaqItemCandidate)
      .map(normalizeFaqItem);
  }
  return [];
}
