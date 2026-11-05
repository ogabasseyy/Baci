import { isValidMerchantSlug } from '@/lib/validation';

export function getPrivateDeliveryEstimateUrl(routingMode?: string, merchantSlug?: string): string | null {
  if (routingMode === 'domain') return '/api/chat/delivery-estimate';
  if (routingMode !== 'path' || !merchantSlug || !isValidMerchantSlug(merchantSlug)) return null;
  return `/api/storefront/${encodeURIComponent(merchantSlug)}/delivery-estimate`;
}
