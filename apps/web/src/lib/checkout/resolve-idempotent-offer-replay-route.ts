import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import {
  type IdempotentOfferReplayResolution,
  resolveIdempotentOfferReplay,
} from '@/lib/checkout/resolve-idempotent-offer-replay';
import type { ResolvableOrderOfferLine } from '@/lib/checkout/resolve-order-offer-economics';

export type OfferReplayRouteResult =
  | { ok: true; value: IdempotentOfferReplayResolution }
  | { ok: false; response: NextResponse };

/**
 * Route adapter for F1 (offer economics): an idempotent retry replays
 * the ORIGINAL order before it can be re-judged against the merchant's
 * CURRENT offers (see resolve-idempotent-offer-replay). On a replay hit
 * the route reuses the stored tax_amount instead of recomputing VAT
 * from parent prices, which would drift the request hash into a
 * conflict. Lives here — not inline in the orders route — per the Boy
 * Scout Rule: the route is far over 300 lines, so touched logic is
 * extracted and the route keeps only the call and the early return.
 */
export async function resolveOfferReplayForOrderRoute({
  merchantId,
  orderItemsPayload,
  requestIdempotencyKey,
  supabase,
}: {
  merchantId: string;
  orderItemsPayload: ResolvableOrderOfferLine[];
  requestIdempotencyKey: string | null;
  supabase: SupabaseClient;
}): Promise<OfferReplayRouteResult> {
  const offerReplay = await resolveIdempotentOfferReplay({
    merchantId,
    orderItemsPayload,
    requestIdempotencyKey,
    supabase,
  });
  if (!offerReplay.ok) {
    if (offerReplay.reason === 'verification_failed') {
      console.error('Order offer verification failed:', offerReplay.error);
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Failed to verify order offers' },
          { status: 500 }
        ),
      };
    }
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid condition offer for order item' },
        { status: 400 }
      ),
    };
  }
  return { ok: true, value: offerReplay.value };
}
