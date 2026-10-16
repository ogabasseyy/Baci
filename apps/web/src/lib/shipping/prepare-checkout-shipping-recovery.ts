import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { toShippingQuoteUpsert } from '@/app/api/shipping/quotes/shipping-quote-persistence';
import { createShippingQuoteRouteProof } from './shipping-quote-route-proof';
import type { QuoteRequest, ShippingQuote } from './types';

/** Fixed-action signing boundary for authenticated owner recovery previews.
 * The route resolves ownership and authoritative sender/items before calling;
 * the RPC independently checks ownership, snapshot, funding and proof binding.
 * Uses only the caller's RLS client, with no service-role client fallback.
 */
export async function prepareCheckoutShippingRecovery(
  supabase: SupabaseClient,
  context: {
    orderId: string;
    merchantId: string;
    fingerprint: string;
    paidShippingFee: number;
    quote: ShippingQuote;
    quoteRequest: QuoteRequest;
  }
): Promise<{
  data: unknown;
  error: { code?: string; message?: string } | null;
}> {
  const { orderId, merchantId, fingerprint, quote, quoteRequest } = context;
  const { latitude, longitude } = quoteRequest.receiver;
  if (
    !orderId ||
    !merchantId ||
    !/^[a-f0-9]{64}$/.test(fingerprint) ||
    quoteRequest.sessionId !== orderId ||
    (quoteRequest.merchantId !== undefined &&
      quoteRequest.merchantId !== merchantId) ||
    quote.provider !== 'GIGL' ||
    quote.currency !== 'NGN' ||
    quote.isStationPickup ||
    quoteRequest.shipmentType !== 'domestic' ||
    !Number.isFinite(context.paidShippingFee) ||
    context.paidShippingFee <= 0 ||
    quote.price !== context.paidShippingFee ||
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180
  )
    throw new Error('invalid_checkout_shipping_recovery_proof_context');
  const persisted = toShippingQuoteUpsert(quote, {
    merchantId,
    sessionId: orderId,
    quoteRequest: { ...quoteRequest, merchantId },
  });
  const proof = createShippingQuoteRouteProof({
    action: 'prepare_customer_checkout_shipping_recovery',
    merchantId,
    subjectId: orderId,
    payload: { order_id: orderId, fingerprint, quote: persisted },
  });
  const { data, error } = await supabase.rpc(
    'prepare_customer_checkout_shipping_recovery' as never,
    {
      p_order_id: orderId,
      p_fingerprint: fingerprint,
      p_quote: persisted,
      p_route_proof: proof,
    } as never
  );
  return { data, error };
}
