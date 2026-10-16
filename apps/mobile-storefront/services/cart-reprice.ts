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

import { getStorefrontProductBaseInventoryByProductIds } from '@/lib/fetch-storefront-product-base-inventory';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import type { CartItem } from '@/stores/cart-store';
import {
  type OfferLineAllocation,
  reconcileOfferLineAllocations,
  reconcileStrictBasePools,
  repriceExactOfferLine,
} from './cart-reprice-exact-offer';
import {
  collectLegacyOfferLineProductIds,
  collectOfferLineProductIds,
  fetchLiveOfferRepriceMap,
  hasLinePriceDrift,
  isParentPricedOfferlessLine,
  pickChangedConditionById,
  pickChangedOfferIdById,
  pickChangedPriceById,
  resolveLegacyOfferId,
} from './cart-reprice-offer-lines';
import type { RepriceResult } from './cart-reprice-types';
import { EMPTY_REPRICE_RESULT } from './cart-reprice-types';
import {
  fetchOfferEligibleParents,
  fetchVariantOverrides,
  resolveVariantLinePrice,
} from './cart-reprice-variants';

export type {
  CartConditionChange,
  CartOfferAdoption,
  CartPriceChange,
  CartUnavailableLine,
  RepriceResult,
} from './cart-reprice-types';
export {
  pickChangedConditionById,
  pickChangedOfferIdById,
  pickChangedPriceById,
};

const log = createLogger('CartReprice');

export async function repriceCartItems(
  items: CartItem[],
  merchantId: string
): Promise<RepriceResult> {
  const productIds = Array.from(
    new Set(items.map((item) => item.product_id).filter(Boolean))
  );
  if (productIds.length === 0 || !merchantId) {
    return EMPTY_REPRICE_RESULT;
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
    // offer line that predates exact offer ids. `has_variants`/`variant_model`
    // feed the offer-parent eligibility gate below.
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select(
        'id, price, has_condition_offers, condition, has_variants, variant_model'
      )
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .in('id', productIds);

    if (productsError || !products) {
      // Fail open: keep the existing cart prices rather than blocking the cart.
      log.warn('Reprice products lookup failed; keeping cart prices', {
        error: productsError?.message,
      });
      return EMPTY_REPRICE_RESULT;
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

    const { overrides: variantOverride, failed: variantLookupFailed } =
      await fetchVariantOverrides(variantIds);

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
    // Parents must still satisfy the order RPC's offer gate (flag on,
    // non-variant-bearing, no live variants) or the priced line dies at
    // checkout with `invalid_offer`. Probe failure skips offer lines.
    const { eligible: offerEligibleParents, failed: offerParentFailed } =
      await fetchOfferEligibleParents(products, offerFetchProductIds);
    // Strict base pools are product-wide: every simple (non-variant,
    // non-voucher) line draws from them. A null fetch skips the pool
    // check below rather than blocking checkout on a read gap.
    const baseInventoryByProductId =
      await getStorefrontProductBaseInventoryByProductIds(
        items.map((item) => item.product_id)
      );

    const result: RepriceResult = {
      priceById: {},
      conditionById: {},
      changes: [],
      conditionChanges: [],
      unavailable: [],
      offerIdById: {},
      adoptions: [],
    };
    // Exact-offer lines (including mid-loop legacy adoptions) priced
    // against a live row: reconciled post-loop against the live
    // allocation, mirroring the order RPC's per-offer aggregate check.
    const offerLineAllocations: OfferLineAllocation[] = [];
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
        } else if (offerLookupFailed || offerParentFailed) {
          continue;
        } else if (!offerEligibleParents.has(item.product_id)) {
          result.unavailable.push({ id: item.id, name: item.name });
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
        if (!offerLookupFailed && !offerParentFailed) {
          // The enclosing predicate narrowed offer_id to a non-empty
          // string; re-key it so the callee's type carries the proof.
          repriceExactOfferLine({
            effectiveItem: {
              ...effectiveItem,
              offer_id: effectiveItem.offer_id,
            },
            item,
            offerEligibleParents,
            offerLineAllocations,
            offerPrice,
            result,
          });
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
      // Authoritative unit price: variant.price_override ?? product.price.
      // (Lookup failure already skipped variant lines above, so a variant
      // id here implies a successful lookup.)
      const liveUnitPrice = item.variant_id
        ? resolveVariantLinePrice(item, variantOverride, basePrice)
        : basePrice;
      if (liveUnitPrice == null) {
        result.unavailable.push({ id: item.id, name: item.name });
        continue;
      }
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

    // A merchant edit or concurrent order can deplete an offer below the
    // cart's aggregate take after the price lookup.
    reconcileOfferLineAllocations({ offerLineAllocations, offerPrice, result });
    reconcileStrictBasePools({ baseInventoryByProductId, items, result });

    return result;
  } catch (error) {
    // Network/unexpected failure must never block the cart or checkout.
    log.warn('Reprice failed unexpectedly; keeping cart prices', {
      error: error instanceof Error ? error.message : String(error),
    });
    return EMPTY_REPRICE_RESULT;
  }
}
