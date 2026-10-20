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
const RESOLVER_RPC_NAME = 'get_loyalty_redemption_for_checkout';

export function createLoyaltyResolverServiceClient(): Pick<
  LoyaltyResolverServiceClient,
  'rpc'
> {
  // Defence in depth: this handle exposes exactly one RPC, not the full
  // service-role surface. Table reads (`.from`) are structurally absent
  // and any other function name throws — the branded type above constrains
  // use at compile time, this facade constrains it at runtime.
  const client = createServiceClient('loyalty-resolver');
  return {
    rpc: ((functionName: string, params?: Record<string, unknown>) => {
      if (functionName !== RESOLVER_RPC_NAME) {
        throw new Error(
          `loyalty-resolver handle refuses RPC '${functionName}'`
        );
      }
      // TS2589 is inference noise, not a type error: resolving the
      // overloaded PostgREST rpc signature for a plain string exceeds the
      // instantiation depth. The runtime shape is pinned by unit test
      // (`exposes only the RPC surface at runtime`, `refuses other RPCs`).
      // @ts-expect-error overloaded rpc resolution is intentionally unchecked here
      return client.rpc(functionName, params);
    }) as LoyaltyResolverServiceClient['rpc'],
  };
}

export type { LoyaltyResolverServiceClient } from '@/lib/supabase/service';
