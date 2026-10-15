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
  type CartOfferAdoption,
  type CartPriceChange,
  type CartUnavailableLine,
  collectLegacyOfferLineProductIds,
  collectOfferLineProductIds,
  fetchLiveOfferRepriceMap,
  getDriftedOfferCondition,
  hasLinePriceDrift,
  isParentPricedOfferlessLine,
  pickChangedConditionById,
  pickChangedOfferIdById,
  pickChangedPriceById,
  resolveLegacyOfferId,
  resolveOfferLinePrice,
} from './cart-reprice-offer-lines';

export type {
  CartConditionChange,
  CartOfferAdoption,
  CartPriceChange,
  CartUnavailableLine,
};
export {
  pickChangedConditionById,
  pickChangedOfferIdById,
  pickChangedPriceById,
};

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
  /** Lines whose row vanished after a successful lookup. Failed lookups
   * fail open and never land here; checkout must stop for these. */
  unavailable: CartUnavailableLine[];
  /**
   * Adopted exact offer ids for legacy offerless lines, keyed by cart
   * line id. The adopted line reprices from the live offer row like an
   * exact offer line, so checkout accepts it.
   */
  offerIdById: Record<string, string>;
  /** Legacy lines that adopted an unambiguous live offer this round. */
  adoptions: CartOfferAdoption[];
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
  unavailable: [],
  offerIdById: {},
  adoptions: [],
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
    // `has_condition_offers` flags products with live offer rows; the parent
    // `condition` distinguishes a true parent-priced base line from a legacy
    // offer line that predates exact offer ids.
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, price, has_condition_offers, condition')
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
    const parentCondition = new Map<string, string | null>();
    for (const product of products) {
      productPrice.set(product.id, Number(product.price));
      if (product.has_condition_offers) {
        conditionOfferProducts.add(product.id);
      }
      parentCondition.set(product.id, product.condition ?? null);
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

    // Live offer rows for exact offer lines AND legacy offerless lines on
    // offer-products (the latter need the rows for unambiguous adoption).
    // A failed lookup skips offer lines rather than falling back to base
    // prices, which would corrupt a valid offer price.
    const offerFetchProductIds = Array.from(
      new Set([
        ...collectOfferLineProductIds(items),
        ...collectLegacyOfferLineProductIds(items, conditionOfferProducts),
      ])
    );
    const { map: offerPrice, failed: offerLookupFailed } =
      await fetchLiveOfferRepriceMap(offerFetchProductIds);

    const result: RepriceResult = {
      priceById: {},
      conditionById: {},
      changes: [],
      conditionChanges: [],
      unavailable: [],
      offerIdById: {},
      adoptions: [],
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

      // Offerless non-variant lines on products with condition offers
      // split two ways (the order RPC prices every such line from the
      // parent unless it carries an exact offer id):
      // - parent-priced base lines (no condition, or the parent's own
      //   condition) fall through to the normal base-price path below;
      //   skipping them would leave a merchant base-price edit unapplied
      //   until checkout rejects the stale total.
      // - legacy offer lines (a non-parent condition, persisted before
      //   exact offer ids) adopt the unambiguous live offer for their
      //   stored condition, or are unavailable when no single offer
      //   matches — checkout would otherwise price them as parent lines
      //   and reject the cart.
      let effectiveItem = item;
      let adoptedOfferId: string | null = null;
      if (
        !item.variant_id &&
        !(typeof item.offer_id === 'string' && item.offer_id.length > 0) &&
        conditionOfferProducts.has(item.product_id)
      ) {
        if (
          isParentPricedOfferlessLine(
            item,
            parentCondition.get(item.product_id)
          )
        ) {
          // Base line: fall through to the productPrice path below.
        } else if (offerLookupFailed) {
          continue;
        } else {
          adoptedOfferId = resolveLegacyOfferId(item, offerPrice);
          if (!adoptedOfferId) {
            result.unavailable.push({ id: item.id, name: item.name });
            continue;
          }
          effectiveItem = { ...item, offer_id: adoptedOfferId };
          result.offerIdById[item.id] = adoptedOfferId;
          result.adoptions.push({
            id: item.id,
            name: item.name,
            offerId: adoptedOfferId,
          });
        }
      }

      // Exact offer lines reprice from the live offer row. A failed lookup
      // skips the line, but a vanished offer after a successful lookup
      // is unavailable (the orders route would reject it).
      if (
        !effectiveItem.variant_id &&
        typeof effectiveItem.offer_id === 'string' &&
        effectiveItem.offer_id.length > 0
      ) {
        if (!offerLookupFailed) {
          const live = resolveOfferLinePrice(effectiveItem, offerPrice);
          if (!live) {
            result.unavailable.push({ id: item.id, name: item.name });
          } else {
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

      const basePrice = productPrice.get(item.product_id);
      if (basePrice == null) {
        // The lookup above succeeded, so a missing row means the product
        // is gone or inactive — unavailable, like a vanished offer.
        result.unavailable.push({ id: item.id, name: item.name });
        continue;
      }
      // A variant row that is missing (deleted/inactive) or belongs to
      // another product after a successful lookup is unavailable: the
      // order RPC joins variants with `v.product_id = p.id` and rejects
      // the whole order with `invalid_variant`. Falling back to the base
      // price would sail past the removal alert and fail at checkout. A
      // row that exists with a null override still inherits the parent
      // price below. (Lookup failure already skipped these lines above.)
      if (item.variant_id && !variantLookupFailed) {
        const row = variantOverride.get(item.variant_id);
        if (!row || row.productId !== item.product_id) {
          result.unavailable.push({ id: item.id, name: item.name });
          continue;
        }
      }
      // Authoritative unit price: variant.price_override ?? product.price.
      // Missing/wrong-product rows already resolved to unavailable above;
      // a null override on a live row still inherits the parent price.
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
