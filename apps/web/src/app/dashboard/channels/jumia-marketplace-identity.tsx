import type { JumiaIntegration } from './use-jumia-integrations';

export function JumiaMarketplaceIdentity({
  integration,
}: {
  integration: JumiaIntegration;
}) {
  const marketplaceKey = integration.marketplace_key;
  if (!(marketplaceKey && !['oauth', 'default'].includes(marketplaceKey))) {
    return null;
  }
  return <> &middot; {marketplaceKey}</>;
}
