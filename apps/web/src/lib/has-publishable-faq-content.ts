import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { extractFaqItems, type MerchantFaqSource } from './extract-faq-items';

export interface MerchantPublishableFaqSource extends MerchantFaqSource {
  template_id?: string | null;
}

export function hasPublishableFaqContent(
  merchant: MerchantPublishableFaqSource
): boolean {
  return (
    merchant.template_id === OGABASSEY_TEMPLATE_ID ||
    extractFaqItems(merchant).length > 0 ||
    Boolean(merchant.pages?.faq?.trim())
  );
}
