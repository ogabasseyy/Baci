import {
  applyApprovedPolicyFaqs,
  FALLBACK_HELP_FAQS,
  type FaqItem,
} from '@/components/storefront/ogabassey/pages/approved-policy-faq';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import {
  extractFaqItems,
  type MerchantFaqSource,
} from '@/lib/extract-faq-items';

export interface ResolveFaqItemsMerchant extends MerchantFaqSource {
  template_id?: string | null;
  slug?: string | null;
}

/**
 * Resolves FAQ items for storefront rendering and structured data generation.
 * If the merchant has custom FAQ items (or legacy content), approved policy
 * overrides are applied. For the Ogabassey merchant using the Ogabassey template
 * without custom FAQs, the fallback help FAQs are normalized and returned so SSR
 * HTML and JSON-LD describe the same questions.
 */
export function resolveStorefrontFaqItems(
  merchant: ResolveFaqItemsMerchant
): FaqItem[] {
  const extracted = extractFaqItems(merchant);
  if (extracted.length > 0) {
    return applyApprovedPolicyFaqs(extracted, merchant.slug ?? undefined);
  }

  if (
    merchant.template_id === OGABASSEY_TEMPLATE_ID &&
    merchant.slug === 'ogabassey'
  ) {
    return applyApprovedPolicyFaqs(FALLBACK_HELP_FAQS, merchant.slug);
  }

  return [];
}
