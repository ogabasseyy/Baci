import type { SupabaseClient } from '@supabase/supabase-js';
import { hasExistingStorefrontOrderForKey } from '@/lib/checkout/has-existing-storefront-order';
import {
  type ResolvableOrderOfferLine,
  resolveOrderOfferEconomics,
} from '@/lib/checkout/resolve-order-offer-economics';
import type { OrderOfferQueryResult } from '@/lib/checkout/verify-order-offer-lines';
import { logger } from '@/lib/logger';

export interface IdempotentOfferReplayResolution {
  isIdempotentOfferOrderReplay: boolean;
  liveOfferPrices: Map<string, number>;
  liveOfferConditions: Map<string, string>;
  /**
   * The stored order's tax_amount on a replay hit. The route uses it
   * instead of recomputing VAT: with the offer gone, a recompute falls
   * back to parent prices, drifts tax_amount, changes the request hash,
   * and turns the retry into an idempotency conflict. Null forces a
   * fresh recompute (fresh orders and fail-open probe/read failures).
   */
  storedReplayTaxAmount: number | null;
}

export type ResolveIdempotentOfferReplayResult =
  | { ok: true; value: IdempotentOfferReplayResolution }
  | { ok: false; reason: 'invalid_offer' }
  | { ok: false; reason: 'verification_failed'; error: unknown };

async function readStoredReplayTaxAmount({
  adminSupabase,
  merchantId,
  requestIdempotencyKey,
}: {
  adminSupabase: SupabaseClient;
  merchantId: string;
  requestIdempotencyKey: string;
}): Promise<number | null> {
  try {
    const { data, error } = await adminSupabase
      .from('orders')
      .select('tax_amount')
      .eq('merchant_id', merchantId)
      .eq('checkout_idempotency_key', requestIdempotencyKey)
      .maybeSingle();
    if (error) {
      logger.warn({
        message:
          'Replay tax read failed; recomputing VAT instead of reusing stored tax',
        merchantId,
        error,
      });
      return null;
    }
    const stored = (data as { tax_amount?: unknown } | null)?.tax_amount;
    return typeof stored === 'number' && Number.isFinite(stored)
      ? stored
      : null;
  } catch (readError) {
    logger.warn({
      message:
        'Replay tax read threw; recomputing VAT instead of reusing stored tax',
      merchantId,
      error: readError,
    });
    return null;
  }
}

/**
 * F1 (offer economics): an idempotent retry must replay the ORIGINAL order
 * before it can be re-judged against the merchant's CURRENT offers. The
 * offer was live when the first attempt validated; if the merchant has
 * since deleted, deactivated, or sold it out, running live verification
 * here would 400 a retry whose completed order the RPC would otherwise
 * replay. Probe for the keyed order first (same lookup the RPC replays on)
 * and skip mutable offer verification on a hit — downstream preflights
 * fall back to parent prices, the discount/rate recomputes are bypassed
 * the same way, and the RPC's request-hash check remains the authority
 * for conflicts.
 */
export async function resolveIdempotentOfferReplay({
  adminSupabase,
  merchantId,
  orderItemsPayload,
  requestIdempotencyKey,
  supabase,
}: {
  adminSupabase: SupabaseClient;
  merchantId: string;
  orderItemsPayload: ResolvableOrderOfferLine[];
  requestIdempotencyKey: string | null;
  supabase: SupabaseClient;
}): Promise<ResolveIdempotentOfferReplayResult> {
  const isIdempotentOfferOrderReplay =
    requestIdempotencyKey && orderItemsPayload.some((item) => item.offer_id)
      ? await hasExistingStorefrontOrderForKey({
          merchantId,
          requestIdempotencyKey,
          supabase,
        })
      : false;
  if (!isIdempotentOfferOrderReplay) {
    // Exact condition offers must name a live offer of their own product:
    // two offers can share one condition, so the stored id is the only
    // thing distinguishing them at fulfillment time.
    const offerEconomics = await resolveOrderOfferEconomics(
      (productId) =>
        supabase.rpc('get_product_offers', {
          p_product_id: productId,
        }) as unknown as Promise<OrderOfferQueryResult>,
      orderItemsPayload
    );
    if (!offerEconomics.ok) {
      return offerEconomics;
    }
    return {
      ok: true,
      value: {
        isIdempotentOfferOrderReplay: false,
        liveOfferConditions: offerEconomics.liveOfferConditions,
        liveOfferPrices: offerEconomics.liveOfferPrices,
        storedReplayTaxAmount: null,
      },
    };
  }

  const storedReplayTaxAmount = requestIdempotencyKey
    ? await readStoredReplayTaxAmount({
        adminSupabase,
        merchantId,
        requestIdempotencyKey,
      })
    : null;
  return {
    ok: true,
    value: {
      isIdempotentOfferOrderReplay: true,
      liveOfferConditions: new Map<string, string>(),
      liveOfferPrices: new Map<string, number>(),
      storedReplayTaxAmount,
    },
  };
}
