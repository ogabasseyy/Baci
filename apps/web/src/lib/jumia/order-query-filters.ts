const JUMIA_OAUTH_SHOP_ID = 'oauth';
const JUMIA_OAUTH_MARKETPLACE_KEY = 'oauth';

export function getJumiaOrderQueryFilters(integration: {
  shopId: string;
  countryCode?: string | null;
  marketplaceKey?: string | null;
}): { country?: string; shopId?: string } {
  // OAuth persistence stores one row per shop and collapses multi-country
  // business clients into a single country_code. Never filter OAuth sync by
  // that collapsed country — use shop-only (or unscoped for the shared
  // fallback shop id) so other active countries are still imported.
  if (integration.shopId === JUMIA_OAUTH_SHOP_ID) {
    return {};
  }

  if (integration.marketplaceKey === JUMIA_OAUTH_MARKETPLACE_KEY) {
    return { shopId: integration.shopId };
  }

  return {
    country: integration.countryCode ?? undefined,
    shopId: integration.shopId,
  };
}
