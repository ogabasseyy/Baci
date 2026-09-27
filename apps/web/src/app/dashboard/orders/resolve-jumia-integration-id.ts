type JumiaIntegrationRef = {
  id: string;
  shop_id?: string | null;
  marketplace_key?: string | null;
};

export function resolveJumiaIntegrationId(
  integrations: readonly JumiaIntegrationRef[],
  requestedIntegrationId: string | null,
  orderShopId?: string | null,
  orderMarketplaceKey?: string | null
): string | null {
  const shopCandidates =
    orderShopId != null && orderShopId !== ''
      ? integrations.filter(
          (integration) => integration.shop_id === orderShopId
        )
      : [...integrations];
  if (shopCandidates.length === 0) return null;

  // One shop can back several business clients; the order's marketplace
  // key selects among same-shop integrations before link scope applies.
  // The neutral 'default' key is shared scope, not a business client, so it
  // must not disambiguate: exact-matching it would eliminate every
  // candidate before the requested link integration is considered.
  const candidates =
    orderMarketplaceKey != null &&
    orderMarketplaceKey !== '' &&
    orderMarketplaceKey !== 'default'
      ? shopCandidates.filter(
          (integration) => integration.marketplace_key === orderMarketplaceKey
        )
      : shopCandidates;
  if (candidates.length === 0) return null;

  if (requestedIntegrationId) {
    return candidates.some(
      (integration) => integration.id === requestedIntegrationId
    )
      ? requestedIntegrationId
      : null;
  }

  return candidates.length === 1 ? candidates[0].id : null;
}
