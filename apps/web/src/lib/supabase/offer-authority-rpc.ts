import type { OfferAuthorityRpcCall } from '@baci/shared/lib';

/**
 * Minimal rpc surface the offer-resolution authority needs. Structural
 * (not SupabaseClient) so server, route-handler, and test clients all
 * satisfy it without casts at the call sites.
 */
export type OfferAuthorityRpcClient = {
  rpc: (
    fn: 'get_storefront_offer_resolution',
    args: { p_merchant_id: string | null; p_product_ids: string[] }
  ) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

/**
 * The one authority RPC adapter: every server caller shares this
 * factory so the RPC name, argument shape, and error normalization
 * cannot drift between copies. Awaits the builder and returns the
 * destructured fields — no double assertion.
 */
export function createOfferAuthorityRpcCall(
  supabase: OfferAuthorityRpcClient
): OfferAuthorityRpcCall {
  return async (args) => {
    const { data, error } = await supabase.rpc(
      'get_storefront_offer_resolution',
      args
    );
    return {
      data,
      error: error ? { message: error.message } : null,
    };
  };
}
