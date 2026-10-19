import 'server-only';

import {
  createServiceClient,
  type LoyaltyResolverServiceClient,
} from '@/lib/supabase/service';

/**
 * Creates the server-only Supabase client for the loyalty
 * checkout-code resolver RPC.
 *
 * The resolver lost anon/authenticated EXECUTE (issue #3696:
 * enumeration oracle), so the two server-side callers behind the
 * proxy-rate-limited routes — the validate route loyalty branch and
 * `resolveLoyaltyCheckoutCode` — resolve through this branded client.
 * The factory's dedicated sentinel keeps this capability separate
 * from the generic service-role client and every other worker brand.
 */
export function createLoyaltyResolverServiceClient(): LoyaltyResolverServiceClient {
  return createServiceClient('loyalty-resolver');
}

export type { LoyaltyResolverServiceClient } from '@/lib/supabase/service';
