type JumiaIntegrationRow = {
  shop_id: string | null;
  is_active: boolean | null;
  connection_method: string | null;
};

export function getActiveSelfAuthorizedJumiaShopIds(
  integrations: JumiaIntegrationRow[]
): Set<string> {
  return new Set(
    integrations
      .filter(
        (row) =>
          row.is_active &&
          row.connection_method === 'self_authorization' &&
          row.shop_id
      )
      .map((row) => row.shop_id as string)
  );
}

export function getJumiaOAuthShopIdsConflictingWithSelfAuthorization(
  shopIds: string[],
  selfAuthorizedShopIds: Set<string>
): string[] {
  return shopIds.filter((shopId) => selfAuthorizedShopIds.has(shopId));
}
