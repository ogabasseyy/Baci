import type { JumiaClient } from '@/lib/jumia/client';
import { verifyJumiaSingleMarketplaceScope } from '@/lib/jumia/verify-jumia-single-marketplace-scope';

/**
 * OAuth integrations emit no business-client selector, so the status/price
 * payloads cannot address one marketplace of many. Require provider proof
 * of a single active business client before pushing.
 */
export async function getJumiaOAuthScopeError(
  client: JumiaClient,
  feedLabel: 'Status' | 'Price'
): Promise<string | null> {
  if (client.marketplaceKey?.trim() !== 'oauth') {
    return null;
  }
  const scope = await verifyJumiaSingleMarketplaceScope(client, {
    strictOAuth: true,
  });
  if (scope.ok) {
    return null;
  }
  if (scope.reason === 'provider_unavailable') {
    return `${feedLabel} update skipped: unable to verify the Jumia shop marketplace scope. Try again.`;
  }
  return `${feedLabel} update skipped: Jumia ${feedLabel.toLowerCase()} updates cannot target a selected marketplace when the OAuth shop exposes multiple business clients.`;
}
