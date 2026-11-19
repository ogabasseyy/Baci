import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { extractFaqItems, type MerchantFaqSource } from './extract-faq-items';

export interface MerchantPublishableFaqSource extends MerchantFaqSource {
  template_id?: string | null;
  slug?: string | null;
}

export function hasPublishableFaqContent(
  merchant: MerchantPublishableFaqSource
): boolean {
  const hasLegacyText = Boolean(
    merchant.pages?.faq
      ?.replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .trim()
  );
  return (
    (merchant.template_id === OGABASSEY_TEMPLATE_ID &&
      merchant.slug === 'ogabassey') ||
    extractFaqItems(merchant).length > 0 ||
    hasLegacyText
  );
}
