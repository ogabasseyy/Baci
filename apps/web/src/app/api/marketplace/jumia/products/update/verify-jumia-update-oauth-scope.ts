import type { JumiaClient } from '@/lib/jumia/client';
import { verifyJumiaSingleMarketplaceScope } from '@/lib/jumia/verify-jumia-single-marketplace-scope';

export type JumiaUpdateOAuthScopeResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'provider_unavailable' | 'multiple_business_clients';
    };

/**
 * OAuth integrations emit no business-client selector, so the status/price
 * payloads cannot address one marketplace of many. Require provider proof
 * of a single active business client before pushing.
 */
export async function verifyJumiaUpdateOAuthScope(
  client: JumiaClient
): Promise<JumiaUpdateOAuthScopeResult> {
  if (client.marketplaceKey?.trim() !== 'oauth') {
    return { ok: true };
  }
  const scope = await verifyJumiaSingleMarketplaceScope(client, {
    strictOAuth: true,
  });
  if (scope.ok) {
    return { ok: true };
  }
  return {
    ok: false,
    reason:
      scope.reason === 'provider_unavailable'
        ? 'provider_unavailable'
        : 'multiple_business_clients',
  };
}

export async function getJumiaOAuthScopeError(
  client: JumiaClient,
  feedLabel: 'Status' | 'Price'
): Promise<string | null> {
  const scope = await verifyJumiaUpdateOAuthScope(client);
  if (scope.ok) {
    return null;
  }
  if (scope.reason === 'provider_unavailable') {
    return `${feedLabel} update skipped: unable to verify the Jumia shop marketplace scope. Try again.`;
  }
  return `${feedLabel} update skipped: Jumia ${feedLabel.toLowerCase()} updates cannot target a selected marketplace when the OAuth shop exposes multiple business clients.`;
}
