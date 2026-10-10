/**
 * Cart repricing against the live catalog.
 *
 * The cart persists the unit price captured at add-to-cart time. Catalog prices
 * can drift afterwards (merchant edits, promos ending), leaving the cart stale.
 * The order API validates each line against the LIVE catalog
 * (`variant.price_override ?? product.price`, offers from `product_offers`) —
 * so a stale cart price triggers confusing checkout rejections
 * (e.g. `negotiated_price_below_floor`).
 *
 * This service re-fetches the authoritative unit price for each cart line using
 * the SAME sources the server's order validation uses:
 *   - base price  -> products.price
 *   - variant     -> get_order_variant_overrides RPC (RLS-safe, anon-granted)
 *   - offer       -> get_product_offers RPC (active offers only)
 * so the reconciled cart basis matches what checkout will accept.
 */

import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { getStorefrontProductOffersByProductIds } from '@/lib/fetch-storefront-product-offers';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import type { CartItem } from '@/stores/cart-store';

const log = createLogger('CartReprice');

// Mirror the RPC's ±1 NGN parity tolerance so display rounding is not treated
// as a price change.
const PRICE_TOLERANCE = 1;

export interface CartPriceChange {
  id: string;
  name: string;
  oldPrice: number;
  newPrice: number;
}

export interface RepriceResult {
  /** Live unit price keyed by cart line id (only lines we could resolve). */
  priceById: Record<string, number>;
  /**
   * Live condition keyed by cart line id, for resolved offer lines whose
   * submitted condition drifted from the live offer row. Applied together
   * with the price so checkout no longer rejects the stale condition.
   */
  conditionById: Record<string, string>;
  /** Lines whose unit price drifted beyond tolerance. */
  changes: CartPriceChange[];
}

type VariantOverrideRow = {
  id: string;
  product_id: string;
  price_override: number | string | null;
};

const EMPTY_RESULT: RepriceResult = {
  priceById: {},
  conditionById: {},
  changes: [],
};

export async function repriceCartItems(
  items: CartItem[],
  merchantId: string
): Promise<RepriceResult> {
  const productIds = Array.from(
    new Set(items.map((item) => item.product_id).filter(Boolean))
  );
  if (productIds.length === 0 || !merchantId) {
    return EMPTY_RESULT;
  }

  try {
    const variantIds = Array.from(
      new Set(
        items
          .map((item) => item.variant_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );

    // Base prices (active products only — mirrors the order RPC's catalog read).
    // `has_condition_offers` flags products whose non-variant lines are priced
    // from `product_offers` (open_box/used) instead of `products.price`.
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, price, has_condition_offers')
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .in('id', productIds);

    if (productsError || !products) {
      // Fail open: keep the existing cart prices rather than blocking the cart.
      log.warn('Reprice products lookup failed; keeping cart prices', {
        error: productsError?.message,
      });
      return EMPTY_RESULT;
    }

    const productPrice = new Map<string, number>();
    const conditionOfferProducts = new Set<string>();
    for (const product of products) {
      productPrice.set(product.id, Number(product.price));
      if (product.has_condition_offers) {
        conditionOfferProducts.add(product.id);
      }
    }

    // Variant overrides via the same RLS-safe RPC the order validation uses.
    // Keep the owning product_id alongside the price so a stale/corrupt cart
    // line cannot be repriced with an override that belongs to another product.
    const variantOverride = new Map<
      string,
      { price: number | null; productId: string }
    >();
    let variantLookupFailed = false;
    if (variantIds.length > 0) {
      const { data: variants, error: variantsError } = (await supabase.rpc(
        'get_order_variant_overrides',
        { p_variant_ids: variantIds }
      )) as unknown as {
        data: VariantOverrideRow[] | null;
        error: { message: string } | null;
      };
      if (variantsError) {
        // Fail open, but do NOT silently fall back to base prices for variant
        // lines — a variant with a price_override would be rewritten to the
        // wrong unit price. Mark the failure so those lines are skipped below.
        variantLookupFailed = true;
        log.warn(
          'Reprice variant override lookup failed; skipping variant lines',
          {
            error: variantsError.message,
          }
        );
      } else {
        for (const variant of variants ?? []) {
          variantOverride.set(variant.id, {
            price:
              variant.price_override == null
                ? null
                : Number(variant.price_override),
            productId: variant.product_id,
          });
        }
      }
    }

    // Live offer prices for exact offer lines, via the same
    // anon-executable RPC checkout validation reads. A merchant-edited
    // offer price would otherwise sail through repricing undetected and
    // fail at order creation with a total/fee mismatch.
    const offerPrice = new Map<
      string,
      { price: number; productId: string; condition: string | null }
    >();
    const offerLineProductIds = Array.from(
      new Set(
        items
          .filter(
            (item) =>
              !item.variant_id &&
              typeof item.offer_id === 'string' &&
              item.offer_id.length > 0
          )
          .map((item) => item.product_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );
    let offerLookupFailed = false;
    if (offerLineProductIds.length > 0) {
      const offersByProduct =
        await getStorefrontProductOffersByProductIds(offerLineProductIds);
      if (!offersByProduct) {
        // Fail open, but do NOT fall back to base prices for offer lines —
        // repricing to products.price would corrupt a valid offer price.
        offerLookupFailed = true;
        log.warn('Reprice offer lookup failed; skipping offer lines');
      } else {
        for (const [productId, offers] of Object.entries(offersByProduct)) {
          for (const offer of offers) {
            if (offer.price != null) {
              offerPrice.set(offer.id, {
                price: Number(offer.price),
                productId,
                condition: offer.condition ?? null,
              });
            }
          }
        }
      }
    }

    const result: RepriceResult = {
      priceById: {},
      conditionById: {},
      changes: [],
    };
    for (const item of items) {
      // Voucher reward lines (quiz awards, price 0) are validated by the
      // voucher flow, not the catalog — never reprice them, or a free award
      // would be turned into a paid line / trigger a bogus price-change alert.
      if (item.voucher_token || item.voucher_award_id) {
        continue;
      }

      // When the override lookup failed, skip variant lines instead of
      // repricing them against the base product price (wrong for any variant
      // carrying a price_override). Non-variant lines still reprice safely.
      if (item.variant_id && variantLookupFailed) {
        continue;
      }

      // Exact offer lines reprice from the live offer row. A failed lookup
      // or a vanished/inactive offer skips the line instead of corrupting
      // it with the base price; availability is validated at checkout.
      if (
        !item.variant_id &&
        typeof item.offer_id === 'string' &&
        item.offer_id.length > 0
      ) {
        if (!offerLookupFailed) {
          const live = offerPrice.get(item.offer_id);
          // Finite zero is a valid live offer price (product_offers has
          // no positive constraint and checkout accepts nonnegative): only
          // non-finite and negative rows are unusable.
          if (
            live &&
            live.productId === item.product_id &&
            Number.isFinite(live.price) &&
            live.price >= 0
          ) {
            result.priceById[item.id] = live.price;
            // A merchant-edited condition must refresh with the price:
            // checkout canonically compares the submitted condition and
            // rejects a drifted line as an invalid offer, so reporting
            // no change here would sail a doomed line into submission.
            // Lines without a submitted condition skip the check, same as
            // the orders route; empty live conditions cannot reconcile.
            const conditionDrifted =
              item.condition != null &&
              typeof live.condition === 'string' &&
              live.condition !== '' &&
              normalizeCanonicalProductCondition(item.condition) !==
                normalizeCanonicalProductCondition(live.condition);
            if (conditionDrifted && typeof live.condition === 'string') {
              result.conditionById[item.id] = live.condition;
            }
            if (
              Math.abs(live.price - item.price) > PRICE_TOLERANCE ||
              conditionDrifted
            ) {
              result.changes.push({
                id: item.id,
                name: item.name,
                oldPrice: item.price,
                newPrice: live.price,
              });
            }
          }
        }
        continue;
      }

      // Non-variant lines WITHOUT an exact offer on products with condition
      // offers (open_box/used) are priced from `product_offers`, not
      // `products.price`. We cannot resolve which offer price applies, so
      // skip them — repricing to the base price would corrupt a valid offer
      // price and raise a bogus drift alert. Checkout still validates these
      // lines against the live offer separately.
      if (!item.variant_id && conditionOfferProducts.has(item.product_id)) {
        continue;
      }

      const basePrice = productPrice.get(item.product_id);
      if (basePrice == null) {
        // Product missing/inactive — leave the line untouched; availability is
        // validated separately at checkout.
        continue;
      }
      // Authoritative unit price: variant.price_override ?? product.price.
      // Only honor an override whose variant actually belongs to this line's
      // product (guards stale/corrupt lines), mirroring the checkout parity
      // `candidateVariant.product_id === item.product_id` check.
      const override = item.variant_id
        ? variantOverride.get(item.variant_id)
        : undefined;
      const overridePrice =
        override && override.productId === item.product_id
          ? override.price
          : undefined;
      const liveUnitPrice = overridePrice != null ? overridePrice : basePrice;
      if (!Number.isFinite(liveUnitPrice) || liveUnitPrice <= 0) {
        continue;
      }

      result.priceById[item.id] = liveUnitPrice;
      if (Math.abs(liveUnitPrice - item.price) > PRICE_TOLERANCE) {
        result.changes.push({
          id: item.id,
          name: item.name,
          oldPrice: item.price,
          newPrice: liveUnitPrice,
        });
      }
    }

    return result;
  } catch (error) {
    // Network/unexpected failure must never block the cart or checkout.
    log.warn('Reprice failed unexpectedly; keeping cart prices', {
      error: error instanceof Error ? error.message : String(error),
    });
    return EMPTY_RESULT;
  }
}

/**
 * Live prices for ONLY the lines that drifted beyond tolerance (`changes`).
 * `priceById` includes every resolved line, so applying it wholesale could
 * clear negotiations on tolerated/unchanged lines — callers that react to a
 * drift should apply just these.
 */
export function pickChangedPriceById(
  result: RepriceResult
): Record<string, number> {
  const changed: Record<string, number> = {};
  for (const change of result.changes) {
    const livePrice = result.priceById[change.id];
    if (typeof livePrice === 'number') {
      changed[change.id] = livePrice;
    }
  }
  return changed;
}

export function pickChangedConditionById(
  result: RepriceResult
): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const change of result.changes) {
    const liveCondition = result.conditionById[change.id];
    if (typeof liveCondition === 'string' && liveCondition !== '') {
      changed[change.id] = liveCondition;
    }
  }
  return changed;
}
