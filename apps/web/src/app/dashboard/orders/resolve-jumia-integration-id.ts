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
  const candidates =
    orderMarketplaceKey != null && orderMarketplaceKey !== ''
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
