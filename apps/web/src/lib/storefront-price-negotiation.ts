import { hasPriceNegotiationEntitlement } from '@/lib/feature-flags';

export interface StorefrontPriceNegotiationMerchant {
  /**
   * Derived capability hint from the public merchant snapshot. Authoritative
   * for storefront presentation when present: the server already evaluated the
   * merchant's plan tier before deriving it.
   */
  price_negotiation_enabled?: boolean | null;
  plan_tier?: string | null;
}

/**
 * Storefront presentation gate for price negotiation.
 *
 * Public snapshot merchants no longer carry raw plan fields, so prefer the
 * derived price_negotiation_enabled hint and fall back to the plan-tier
 * entitlement only for private/dashboard callers that still receive raw
 * merchant rows. Private negotiation/order APIs stay authoritative.
 */
export function hasStorefrontPriceNegotiation(
  merchant: StorefrontPriceNegotiationMerchant | null | undefined
): boolean {
  if (!merchant) return false;
  if (typeof merchant.price_negotiation_enabled === 'boolean') {
    return merchant.price_negotiation_enabled;
  }
  return hasPriceNegotiationEntitlement(merchant.plan_tier);
}
