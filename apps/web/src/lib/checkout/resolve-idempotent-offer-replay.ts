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
  /**
   * The stored order's discount_amount on a replay hit. The F1 bypass
   * skips the negotiation recompute, so without the restore the retry
   * hashes a zero discount against the first attempt's nonzero one.
   * Null forces the normal derived-discount path.
   */
  storedReplayDiscountAmount: number | null;
}

export type ResolveIdempotentOfferReplayResult =
  | { ok: true; value: IdempotentOfferReplayResolution }
  | { ok: false; reason: 'invalid_offer' }
  | { ok: false; reason: 'verification_failed'; error: unknown };

interface StoredReplayEconomics {
  taxAmount: number | null;
  discountAmount: number | null;
  /** `${product_id}::${offer_id}` → stored line condition. */
  conditions: Map<string, string>;
  /** `${product_id}::${offer_id}` → stored canonical assurance fee. */
  assuranceFees: Map<string, number>;
}

const EMPTY_REPLAY_ECONOMICS: StoredReplayEconomics = {
  taxAmount: null,
  discountAmount: null,
  conditions: new Map<string, string>(),
  assuranceFees: new Map<string, number>(),
};

async function readStoredReplayEconomics({
  merchantId,
  requestIdempotencyKey,
  supabase,
}: {
  merchantId: string;
  requestIdempotencyKey: string;
  supabase: SupabaseClient;
}): Promise<StoredReplayEconomics> {
  // Narrowly scoped SECURITY DEFINER RPC on the caller's normal client:
  // user-facing routes must never use the service-role client, so the
  // stored economics cross the boundary as one tax + line projection.
  try {
    const { data, error } = await supabase.rpc(
      'get_storefront_order_replay_economics',
      {
        p_checkout_idempotency_key: requestIdempotencyKey,
        p_merchant_id: merchantId,
      }
    );
    if (error) {
      logger.warn({
        message:
          'Replay economics read failed; recomputing instead of reusing stored economics',
        merchantId,
        error,
      });
      return EMPTY_REPLAY_ECONOMICS;
    }
    // TABLE functions decode as row arrays; zero rows means the keyed
    // order vanished between the probe and this read — fail open.
    const row = (Array.isArray(data) ? data[0] : data) as {
      tax_amount?: unknown;
      discount_amount?: unknown;
      items?: unknown;
    } | null;
    // PostgREST may decode numeric as a string; blank/null stays fail-open.
    const coerceAmount = (raw: unknown): number | null => {
      const value =
        typeof raw === 'number'
          ? raw
          : typeof raw === 'string' && raw.trim() !== ''
            ? Number(raw)
            : Number.NaN;
      return Number.isFinite(value) ? value : null;
    };
    const conditions = new Map<string, string>();
    const assuranceFees = new Map<string, number>();
    const items = row?.items;
    if (Array.isArray(items)) {
      for (const entry of items as {
        product_id?: unknown;
        offer_id?: unknown;
        condition?: unknown;
        assurance_fee?: unknown;
      }[]) {
        if (entry?.product_id == null || entry?.offer_id == null) continue;
        const key = `${String(entry.product_id)}::${String(entry.offer_id)}`;
        if (typeof entry?.condition === 'string' && entry.condition !== '') {
          conditions.set(key, entry.condition);
        }
        const fee = coerceAmount(entry?.assurance_fee);
        if (fee != null) {
          assuranceFees.set(key, fee);
        }
      }
    }
    return {
      taxAmount: coerceAmount(row?.tax_amount),
      discountAmount: coerceAmount(row?.discount_amount),
      conditions,
      assuranceFees,
    };
  } catch (readError) {
    logger.warn({
      message:
        'Replay economics read threw; recomputing instead of reusing stored economics',
      merchantId,
      error: readError,
    });
    return EMPTY_REPLAY_ECONOMICS;
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
 * for conflicts. The stored tax_amount, discount_amount, per-line
 * conditions, and per-line assurance fees are restored from the keyed
 * order so the retry hashes the identical payload.
 */
export async function resolveIdempotentOfferReplay({
  merchantId,
  orderItemsPayload,
  requestIdempotencyKey,
  supabase,
}: {
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
        storedReplayDiscountAmount: null,
      },
    };
  }

  const stored = requestIdempotencyKey
    ? await readStoredReplayEconomics({
        merchantId,
        requestIdempotencyKey,
        supabase,
      })
    : EMPTY_REPLAY_ECONOMICS;
  // The first attempt rewrote canonical-alias line conditions to the live
  // offer spelling before hashing; restore the stored spelling per line so
  // the identical retry hashes the same payload (mirrors the economics
  // mutation above — item conditions are hash-significant). Lines without
  // a stored match keep the client spelling (fail-open per line). The
  // stored canonical assurance fee restores the same way: the replay
  // price map is empty, so the fee recompute below is a no-op and the
  // retry would otherwise hash the client-derived fee.
  for (const item of orderItemsPayload) {
    if (item.offer_id == null) continue;
    const key = `${String(item.product_id)}::${String(item.offer_id)}`;
    const storedCondition = stored.conditions.get(key);
    if (storedCondition != null) {
      item.condition = storedCondition;
    }
    const storedFee = stored.assuranceFees.get(key);
    if (storedFee != null) {
      item.assurance_fee = storedFee;
    }
  }
  return {
    ok: true,
    value: {
      isIdempotentOfferOrderReplay: true,
      liveOfferConditions: new Map<string, string>(),
      liveOfferPrices: new Map<string, number>(),
      storedReplayTaxAmount: stored.taxAmount,
      storedReplayDiscountAmount: stored.discountAmount,
    },
  };
}
