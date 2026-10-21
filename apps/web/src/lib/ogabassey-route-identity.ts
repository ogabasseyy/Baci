import {
  OGABASSEY_DOMAIN,
  OGABASSEY_MERCHANT_ID,
  OGABASSEY_TEMPLATE_ID,
} from '@/config/ogabassey';

export function getKnownOgaBasseyMerchantId(
  storeSlug: string
): typeof OGABASSEY_MERCHANT_ID | null {
  const normalizedSlug = storeSlug.trim().toLowerCase();
  const normalizedTemplateId = OGABASSEY_TEMPLATE_ID.toLowerCase();
  const normalizedDomain = OGABASSEY_DOMAIN.toLowerCase();

  return normalizedSlug === normalizedTemplateId ||
    normalizedSlug === normalizedDomain
    ? OGABASSEY_MERCHANT_ID
    : null;
}
