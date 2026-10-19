import {
  type MarketplaceIntegrationRow,
  readOrderSyncEnabled,
} from './order-sync-mappers';

export function buildJumiaOrderSyncScope(
  integration: Pick<
    MarketplaceIntegrationRow,
    | 'merchant_id'
    | 'shop_id'
    | 'country_code'
    | 'marketplace_key'
    | 'jumia_authorization_id'
  >
): string {
  const authorizationId = integration.jumia_authorization_id?.trim() || 'oauth';
  // Jumia's Orders endpoint can filter by shop and country, but has no
  // business-client parameter. Integrations sharing the same authorization
  // grant therefore receive the same provider order set; run one sync for
  // that provider scope rather than fetching and processing it repeatedly.
  return `${integration.merchant_id}:${integration.shop_id ?? 'oauth'}:${integration.country_code ?? ''}:${authorizationId}`;
}

/**
 * Pick one order-sync-enabled integration per merchant+shop+country+grant scope.
 * Disabled siblings must not claim the scope ahead of an enabled row.
 */
export function selectJumiaOrderSyncIntegrations(
  integrations: readonly MarketplaceIntegrationRow[]
): MarketplaceIntegrationRow[] {
  const scoped = new Map<string, MarketplaceIntegrationRow[]>();

  for (const integration of integrations) {
    const orderScope = buildJumiaOrderSyncScope(integration);
    const candidates = scoped.get(orderScope);
    if (candidates) candidates.push(integration);
    else scoped.set(orderScope, [integration]);
  }

  return [...scoped.values()].flatMap((scopeIntegrations) => {
    const candidates = scopeIntegrations.filter((integration) =>
      readOrderSyncEnabled(integration.sync_config)
    );
    if (candidates.length === 0) return [];

    // Database result order is not a stable choice when several marketplace
    // rows share one provider scope. Pick a deterministic cursor owner and
    // mark the scope so its cache rows are stored independently of that row's
    // marketplace key.
    const marketplaceKeys = new Set(
      scopeIntegrations.map(
        (candidate) => candidate.marketplace_key?.trim() || ''
      )
    );
    const [selected] =
      marketplaceKeys.size > 1
        ? [...candidates].sort((left, right) => {
            const keyComparison = (
              left.marketplace_key?.trim() || ''
            ).localeCompare(right.marketplace_key?.trim() || '');
            return keyComparison || left.id.localeCompare(right.id);
          })
        : candidates;
    return [
      marketplaceKeys.size > 1
        ? { ...selected, orderSyncScope: 'shared' as const }
        : selected,
    ];
  });
}
