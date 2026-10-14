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

interface StoredReplayLine {
  condition: string | null;
  fee: number | null;
}

interface StoredReplayEconomics {
  taxAmount: number | null;
  discountAmount: number | null;
  /** Fee-identity key → stored lines in projection order. */
  lines: Map<string, StoredReplayLine[]>;
  /**
   * Reduced-identity (product/quantity/assurance, no offer) key →
   * stored lines whose offer row was deleted (ON DELETE SET NULL).
   * Retry lines match here only when exactly one candidate exists.
   */
  offerlessLines: Map<string, StoredReplayLine[]>;
}

const EMPTY_REPLAY_ECONOMICS: StoredReplayEconomics = {
  taxAmount: null,
  discountAmount: null,
  lines: new Map<string, StoredReplayLine[]>(),
  offerlessLines: new Map<string, StoredReplayLine[]>(),
};

/**
 * Fee-identity key shared by the stored projection and the retry payload.
 * Mirrors the idempotency hash's normalization (trimmed/lowercased text,
 * finite-number-or-0, strict boolean). Every field must be unchanged
 * between the hashed request and the stored row: quantity and
 * has_assurance pass through untouched, while price does not — the
 * order RPC persists the live (or negotiated) price and the hash covers
 * the submitted price, so a days-old stale quote would never match its
 * stored row on price. Residual ambiguity (same key, different stored
 * fees) requires distinct negotiated prices on otherwise identical
 * lines, which both carts merge away — direct-API only, and a swap
 * there fails closed into a conflict, never silent corruption.
 * Condition stays out for the same reason: the first attempt rewrites
 * alias spellings to the live offer spelling before hashing.
 */
function replayLineIdentityKey(parts: {
  productId: unknown;
  offerId: unknown;
  quantity: unknown;
  hasAssurance: unknown;
}): string {
  const text = (raw: unknown): string =>
    typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const num = (raw: unknown): number => {
    const value =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw)
          : Number.NaN;
    return Number.isFinite(value) ? value : 0;
  };
  return [
    text(parts.productId),
    text(parts.offerId),
    num(parts.quantity),
    parts.hasAssurance === true,
  ].join('::');
}

/**
 * Pops the single offerless stored line for a reduced identity, or
 * returns null when zero or several candidates exist. Consuming (not
 * peeking) keeps repeated identical retry lines honest: only the
 * first replays from the stored row, later ones fail open per line.
 */
function consumeUnambiguousOfferlessLine(
  offerlessLines: Map<string, StoredReplayLine[]>,
  parts: {
    productId: unknown;
    quantity: unknown;
    hasAssurance: unknown;
  }
): StoredReplayLine | null {
  const key = replayLineIdentityKey({ ...parts, offerId: null });
  const queue = offerlessLines.get(key);
  if (queue?.length !== 1) {
    return null;
  }
  return queue.shift() ?? null;
}

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
    const lines = new Map<string, StoredReplayLine[]>();
    const offerlessLines = new Map<string, StoredReplayLine[]>();
    const items = row?.items;
    if (Array.isArray(items)) {
      // An order can repeat one product+offer across lines (distinct
      // quantities, prices, or assurance choices, hence distinct fees).
      // The idempotency hash sorts lines, so a reordered retry is
      // hash-equivalent and request position cannot pair stored fees to
      // payload lines — match by fee-identity instead. Full duplicates
      // queue behind one key and consume in order; their fees are
      // interchangeable by construction.
      for (const entry of items as {
        product_id?: unknown;
        offer_id?: unknown;
        condition?: unknown;
        assurance_fee?: unknown;
        quantity?: unknown;
        has_assurance?: unknown;
      }[]) {
        if (entry?.product_id == null) continue;
        const key = replayLineIdentityKey({
          productId: entry.product_id,
          offerId: entry.offer_id,
          quantity: entry.quantity,
          hasAssurance: entry.has_assurance,
        });
        const target = entry?.offer_id == null ? offerlessLines : lines;
        const queue = target.get(key) ?? [];
        queue.push({
          condition:
            typeof entry?.condition === 'string' && entry.condition !== ''
              ? entry.condition
              : null,
          fee: coerceAmount(entry?.assurance_fee),
        });
        target.set(key, queue);
      }
    }
    return {
      taxAmount: coerceAmount(row?.tax_amount),
      discountAmount: coerceAmount(row?.discount_amount),
      lines,
      offerlessLines,
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
  // retry would otherwise hash the client-derived fee. Repeated
  // product+offer lines consume their per-key ordinal in payload order
  // (a retry resubmits the identical payload, so ordinals line up);
  // lines without a stored match keep the client values (fail-open per
  // line). Each payload line pops one stored line with the same
  // fee-identity, so reordered retries (hash-equivalent under the sorted
  // idempotency hash) still pair correctly.
  for (const item of orderItemsPayload) {
    if (item.offer_id == null) continue;
    const key = replayLineIdentityKey({
      productId: item.product_id,
      offerId: item.offer_id,
      quantity: item.quantity,
      hasAssurance: item.has_assurance,
    });
    // Exact fee-identity first; when the offer row was deleted after
    // the first attempt (ON DELETE SET NULL) the stored line sits in
    // the offerless map instead. Fall back only when exactly one
    // reduced-identity candidate exists — sibling deleted offers stay
    // fail-open (conflict) rather than restoring the wrong spelling.
    const storedLine =
      stored.lines.get(key)?.shift() ??
      consumeUnambiguousOfferlessLine(stored.offerlessLines, {
        productId: item.product_id,
        quantity: item.quantity,
        hasAssurance: item.has_assurance,
      });
    if (storedLine == null) continue;
    if (storedLine.condition != null) {
      item.condition = storedLine.condition;
    }
    if (storedLine.fee != null) {
      item.assurance_fee = storedLine.fee;
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
