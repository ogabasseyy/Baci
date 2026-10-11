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

import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import type { CartItem } from '@/stores/cart-store';
import {
  type CartConditionChange,
  type CartPriceChange,
  collectOfferLineProductIds,
  fetchLiveOfferRepriceMap,
  getDriftedOfferCondition,
  hasLinePriceDrift,
  pickChangedConditionById,
  pickChangedPriceById,
  resolveOfferLinePrice,
} from './cart-reprice-offer-lines';

export type { CartConditionChange, CartPriceChange };
export { pickChangedConditionById, pickChangedPriceById };

const log = createLogger('CartReprice');

export interface RepriceResult {
  /** Live unit price keyed by cart line id (only lines we could resolve). */
  priceById: Record<string, number>;
  /**
   * Live condition keyed by cart line id, for resolved offer lines whose
   * submitted condition drifted from the live offer row. Applied together
   * with the price so checkout no longer rejects the stale condition.
   */
  conditionById: Record<string, string>;
  /** Lines whose extended line total drifted beyond tolerance. */
  changes: CartPriceChange[];
  /**
   * Lines whose offer condition drifted without a price move. Tracked
   * separately from price changes so a condition-only refresh does not
   * render as a bogus "X to X" price move.
   */
  conditionChanges: CartConditionChange[];
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
  conditionChanges: [],
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

    // Live offer rows for exact offer lines. A failed lookup skips offer
    // lines rather than falling back to base prices, which would corrupt
    // a valid offer price.
    const { map: offerPrice, failed: offerLookupFailed } =
      await fetchLiveOfferRepriceMap(collectOfferLineProductIds(items));

    const result: RepriceResult = {
      priceById: {},
      conditionById: {},
      changes: [],
      conditionChanges: [],
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
          const live = resolveOfferLinePrice(item, offerPrice);
          if (live) {
            result.priceById[item.id] = live.price;
            // A merchant-edited condition refreshes with the price so the
            // line matches what checkout will accept.
            const driftedCondition = getDriftedOfferCondition(
              item.condition,
              live.condition
            );
            if (driftedCondition) {
              result.conditionById[item.id] = driftedCondition;
            }
            // Line basis (not unit): checkout rejects an extended-total
            // drift past tolerance, so a sub-tolerance unit move on
            // quantity > 1 must still surface and refresh.
            if (hasLinePriceDrift(live.price, item.price, item.quantity)) {
              result.changes.push({
                id: item.id,
                name: item.name,
                oldPrice: item.price,
                newPrice: live.price,
              });
            }
            // A condition-only refresh still reconciles (conditionById
            // above) but must not masquerade as a price move: identical
            // old/new prices would render "X to X" and abort checkout
            // with a misleading "prices changed" message.
            if (driftedCondition && item.condition) {
              result.conditionChanges.push({
                id: item.id,
                name: item.name,
                oldCondition: item.condition,
                newCondition: driftedCondition,
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
      if (hasLinePriceDrift(liveUnitPrice, item.price, item.quantity)) {
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
