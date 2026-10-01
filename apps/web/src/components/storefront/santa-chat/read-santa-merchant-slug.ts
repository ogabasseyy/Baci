import { SANTA_MERCHANT_SLUG_HEADER } from '@/lib/agentic/santa-merchant-slug-header';
import { isValidMerchantSlug } from '@/lib/validation';

export function readSantaMerchantSlug(response: Response): string | null {
  const slug = response.headers.get(SANTA_MERCHANT_SLUG_HEADER)?.trim();

  return slug && isValidMerchantSlug(slug) ? slug : null;
}
