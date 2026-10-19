const SHARED_JUMIA_MARKETPLACE_KEYS = new Set(['', 'default', 'oauth']);

type JumiaConsignmentBusinessClientCodeResult =
  | { ok: true; businessClientCode: string }
  | { ok: false };

/**
 * Binds consignment requests to the marketplace selected by the integration.
 * Legacy OAuth integrations do not carry a provider business-client key, so
 * their explicitly supplied code remains the only available provider scope.
 */
export function resolveJumiaConsignmentBusinessClientCode(
  configuredMarketplaceKey: string | null | undefined,
  requestedBusinessClientCode: string
): JumiaConsignmentBusinessClientCodeResult {
  const configured = configuredMarketplaceKey?.trim() ?? '';
  const requested = requestedBusinessClientCode.trim();

  if (
    !SHARED_JUMIA_MARKETPLACE_KEYS.has(configured) &&
    configured !== requested
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    businessClientCode: SHARED_JUMIA_MARKETPLACE_KEYS.has(configured)
      ? requested
      : configured,
  };
}
