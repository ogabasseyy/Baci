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
export function createLoyaltyResolverServiceClient(): Pick<
  LoyaltyResolverServiceClient,
  'rpc'
> {
  // Defence in depth: expose only the RPC surface at runtime, not the full
  // service-role client. Table reads (`.from`) and other RPCs are
  // impossible through this handle even if a future caller tries — the
  // branded type above constrains use at compile time, this facade
  // constrains it at runtime.
  const client = createServiceClient('loyalty-resolver');
  // TS2589 is binding noise, not a type error: inferring `bind` over the
  // overloaded PostgREST rpc signature exceeds the instantiation depth.
  // The runtime shape is pinned by unit test (`exposes only the RPC
  // surface at runtime`) and the declared Pick return type above.
  // @ts-expect-error binding the overloaded rpc signature is intentionally unchecked here
  return { rpc: client.rpc.bind(client) };
}

export type { LoyaltyResolverServiceClient } from '@/lib/supabase/service';
