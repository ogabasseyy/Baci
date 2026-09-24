import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest, NextResponse } from 'next/server';
import type { JumiaTokenResponse } from '@/schemas/jumia';
import { persistJumiaOAuthConnection } from './oauth-persistence';
import { jumiaOAuthCallbackRedirect } from './oauth-redirect';

/**
 * Persists the exchanged OAuth connection and maps the outcome to a
 * channels-page redirect. Only the success redirect clears OAuth cookies;
 * error redirects leave them for a retry.
 */
export async function redirectForJumiaOAuthPersistence(
  request: NextRequest,
  args: {
    merchantId: string;
    supabase: SupabaseClient;
    tokens: JumiaTokenResponse;
    variantResult?: string;
  }
): Promise<NextResponse> {
  const persistence = await persistJumiaOAuthConnection({
    merchantId: args.merchantId,
    supabase: args.supabase,
    tokens: args.tokens,
  });
  if (
    persistence.status === 'database_error' ||
    persistence.status === 'shop_discovery_failed'
  ) {
    return jumiaOAuthCallbackRedirect.create(request, {
      error: persistence.status,
    });
  }
  if (persistence.status === 'shop_already_self_authorized') {
    return jumiaOAuthCallbackRedirect.create(request, {
      error: 'shop_already_self_authorized',
      shops: persistence.shopIds.join(','),
    });
  }
  // Empty shop discovery persists only an inactive fallback integration:
  // report it as incomplete (like the mobile exchange) instead of success.
  // A reconnect whose shops already exist keeps the success redirect.
  if (persistence.isFallback) {
    return jumiaOAuthCallbackRedirect.create(request, {
      error: 'no_shops_discovered',
    });
  }
  const redirectQuery: Record<string, string | undefined> =
    persistence.shopIds.length > 0
      ? {
          success: 'jumia_connected',
          shops: persistence.shopIds.join(','),
        }
      : {
          success: 'jumia_connected',
        };
  if (args.variantResult) {
    redirectQuery.variant_result = args.variantResult;
  }
  const response = jumiaOAuthCallbackRedirect.create(request, redirectQuery);
  return jumiaOAuthCallbackRedirect.clear(response);
}
