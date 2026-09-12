import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { toShippingQuoteUpsert } from '@/app/api/shipping/quotes/shipping-quote-persistence';
import type { QuoteRequest, ShippingQuote } from '@/lib/shipping/types';
import { createShippingQuoteRouteProof } from './shipping-quote-route-proof';

/**
 * Persist a provider-refreshed quote.
 * Every refresh is order-scoped and carries a server HMAC over the complete
 * replacement quote. There is deliberately no service-role fallback here:
 * this helper is reachable from authenticated booking routes only.
 */
export async function persistRefreshedShippingQuote(
  supabase: SupabaseClient,
  quote: ShippingQuote,
  context: {
    merchantId: string;
    sessionId: string;
    quoteRequest: QuoteRequest;
    orderId: string;
  }
): Promise<{ error: { code?: string; message?: string } | null }> {
  if (!context.orderId || !context.merchantId) {
    throw new Error('order-scoped shipping quote refresh requires identity');
  }
  const persisted = toShippingQuoteUpsert(quote, context);
  const persistedProof = createShippingQuoteRouteProof({
    action: 'persist_refreshed_order_shipping_quote',
    merchantId: context.merchantId,
    subjectId: context.orderId,
    payload: { order_id: context.orderId, quote: persisted },
  });
  const { error } = await supabase.rpc(
    'persist_refreshed_order_shipping_quote' as never,
    {
      p_order_id: context.orderId,
      p_quote: persisted,
      p_route_proof: persistedProof,
    } as never
  );
  return { error };
}
