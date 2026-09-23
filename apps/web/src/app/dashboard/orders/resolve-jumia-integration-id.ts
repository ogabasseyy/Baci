type JumiaIntegrationRef = { id: string; shop_id?: string | null };

export function resolveJumiaIntegrationId(
  integrations: readonly JumiaIntegrationRef[],
  requestedIntegrationId: string | null,
  orderShopId?: string | null
): string | null {
  const candidates =
    orderShopId != null && orderShopId !== ''
      ? integrations.filter(
          (integration) => integration.shop_id === orderShopId
        )
      : [...integrations];
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
