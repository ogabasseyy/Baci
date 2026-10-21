import {
  fetchOfferResolutions,
  type ResolvedOfferResolution,
} from '@baci/shared/lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasStockedOffer } from '@/lib/has-stocked-offer';
import { hasStockedRelatedBlogVariant } from '@/lib/has-stocked-related-blog-variant';
import { hydrateRelatedBlogProductSerializedInventory } from '@/lib/hydrate-related-blog-product-serialized-inventory';
import { mergeRelatedBlogProductSerializedInventory } from '@/lib/merge-related-blog-product-serialized-inventory';
import { normalizeOfferRows } from '@/lib/normalize-offer-rows';
import { getEffectiveStock } from '@/lib/product-stock';
import type {
  RelatedBlogProduct,
  RelatedBlogProductOffer,
  RelatedBlogProductVariant,
} from '@/lib/related-blog-products';
import { isValidUuid } from '@/lib/sanitize-core';
import { createOfferAuthorityRpcCall } from '@/lib/supabase/offer-authority-rpc';
import { toFinitePrice } from '@/lib/to-finite-price';

interface VariantStockRow {
  id?: string | null;
  inventory_tracking_policy?: string | null;
  price_override?: number | string | null;
  product_id?: string | null;
  stock_quantity?: number | string | null;
}
interface AvailabilityResolution {
  available?: boolean;
  offers?: RelatedBlogProductOffer[];
  variants?: RelatedBlogProductVariant[];
}
type AvailabilityPair = readonly [string, AvailabilityResolution | undefined];
type HydrateRelatedBlogProductAvailabilityOptions = {
  /** Merchant UUID used to resolve serialized inventory through the canonical public path. */
  merchantId?: string;
  /** Throw after an RPC error so a cache scope cannot persist a degraded rail. */
  throwOnError?: boolean;
};
function isVariantStockRow(value: unknown): value is VariantStockRow {
  return typeof value === 'object' && value !== null;
}

function normalizeVariantRows(
  data: unknown,
  product: RelatedBlogProduct
): RelatedBlogProductVariant[] {
  if (!Array.isArray(data)) return [];

  return data.flatMap((variant) => {
    if (!isVariantStockRow(variant) || variant.product_id !== product.id) {
      return [];
    }
    const priceOverride = toFinitePrice(variant.price_override);
    const parentPrice = toFinitePrice(product.price);
    return [
      {
        ...(variant.id ? { id: variant.id } : {}),
        ...(variant.inventory_tracking_policy
          ? { inventory_tracking_policy: variant.inventory_tracking_policy }
          : {}),
        ...(priceOverride !== null
          ? { price_override: priceOverride }
          : parentPrice !== null
            ? { price_override: parentPrice }
            : {}),
        stock_quantity: toFinitePrice(variant.stock_quantity),
      },
    ];
  });
}

function needsAlternateAvailability(product: RelatedBlogProduct): boolean {
  const hasInventorySignal =
    product.manage_stock !== undefined ||
    product.stock !== undefined ||
    product.stock_quantity !== undefined;

  return (
    product.manage_stock !== false &&
    hasInventorySignal &&
    getEffectiveStock(product) === 0
  );
}

export async function hydrateRelatedBlogProductAvailability(
  supabase: SupabaseClient,
  products: readonly RelatedBlogProduct[],
  options: HydrateRelatedBlogProductAvailabilityOptions = {}
): Promise<RelatedBlogProduct[]> {
  const availabilityErrors: unknown[] = [];
  const offerCandidates = products.filter(
    (product) => product.has_condition_offers === true
  );
  const canResolveSerializedInventory = Boolean(
    options.merchantId && products.some((product) => isValidUuid(product.id))
  );
  const variantCandidates = products.filter(
    (product) =>
      product.has_variants === true &&
      isValidUuid(product.id) &&
      (needsAlternateAvailability(product) || canResolveSerializedInventory)
  );

  const merchantId = options.merchantId;
  if (
    offerCandidates.length === 0 &&
    variantCandidates.length === 0 &&
    !canResolveSerializedInventory
  ) {
    return [...products];
  }

  // Malformed ids cannot join the batched authority call; they resolve
  // undefined individually, like a per-product lookup failure did.
  const validOfferCandidates = offerCandidates.filter((product) =>
    isValidUuid(product.id)
  );
  const unresolvableOfferIds = offerCandidates
    .filter((product) => !isValidUuid(product.id))
    .map((product) => product.id);
  const offerAvailabilityPromise: Promise<AvailabilityPair[]> =
    validOfferCandidates.length > 0
      ? (async () => {
          try {
            // The shared chunking client (200 ids per call): one
            // unbounded call would trip the SQL batch cap and lose
            // every pair. Lookup failures throw into the shared
            // catch below (warn + undefined pairs, or rethrow with
            // throwOnError) exactly like the old error branch.
            const resolutions = await fetchOfferResolutions(
              createOfferAuthorityRpcCall(supabase),
              {
                merchantId:
                  merchantId && isValidUuid(merchantId) ? merchantId : null,
                productIds: validOfferCandidates.map((product) => product.id),
              }
            );
            const byProduct = new Map<string, ResolvedOfferResolution[]>();
            for (const resolution of resolutions.values()) {
              // Live SQL withholds gated-out rows; a partial/stale
              // projection that still carries one must never price or
              // stock the rail (checkout rejects ineligible parents).
              // Rows without a finite price are skipped, never
              // zero-priced: same fail-closed guards as MCP/native.
              if (resolution.parentEligible !== true) continue;
              if (resolution.priceBasis === null) continue;
              const list = byProduct.get(resolution.productId) ?? [];
              list.push(resolution);
              byProduct.set(resolution.productId, list);
            }
            return validOfferCandidates.map((product) => {
              // Availability prices from the live basis and counts the
              // allocatable stock (policy-capped, parent-inherited):
              // exactly what checkout enforces.
              const rows = (byProduct.get(product.id) ?? []).map(
                (resolution) => ({
                  condition: resolution.condition,
                  price: resolution.priceBasis,
                  compare_at_price: resolution.compareAtPrice ?? null,
                  status: 'active',
                  // Null is unbounded (unlimited policy with no
                  // scalar): purchasable, per the shared contract —
                  // never zero stock.
                  stock_quantity:
                    resolution.allocatableStock ?? Number.MAX_SAFE_INTEGER,
                })
              );
              return [
                product.id,
                {
                  available: hasStockedOffer(rows, product.condition),
                  offers: normalizeOfferRows(rows, product.condition),
                },
              ] as const;
            });
          } catch (error) {
            availabilityErrors.push(error);
            console.warn(
              'Related blog product offer availability unavailable',
              {
                productIds: validOfferCandidates.map((product) => product.id),
                error,
              }
            );
            return validOfferCandidates.map<AvailabilityPair>((product) => [
              product.id,
              undefined,
            ]);
          }
        })()
      : Promise.resolve([] as AvailabilityPair[]);
  const unresolvableOfferPairs: AvailabilityPair[] = unresolvableOfferIds.map(
    (id) => [id, undefined]
  );
  const variantAvailabilityPromise: Promise<AvailabilityPair[]> =
    variantCandidates.length > 0
      ? (async () => {
          try {
            const { data, error } = await supabase.rpc(
              'get_storefront_product_variants',
              {
                p_product_ids: variantCandidates.map((product) => product.id),
              }
            );

            if (error) {
              availabilityErrors.push(error);
              console.warn(
                'Related blog product variant availability unavailable',
                {
                  productIds: variantCandidates.map((product) => product.id),
                  error,
                }
              );
              return variantCandidates.map<AvailabilityPair>((product) => [
                product.id,
                undefined,
              ]);
            }

            return variantCandidates.map(
              (product) =>
                [
                  product.id,
                  {
                    available: hasStockedRelatedBlogVariant(data, product),
                    variants: normalizeVariantRows(data, product),
                  },
                ] satisfies AvailabilityPair
            );
          } catch (error) {
            availabilityErrors.push(error);
            console.warn(
              'Related blog product variant availability unavailable',
              {
                productIds: variantCandidates.map((product) => product.id),
                error,
              }
            );
            return variantCandidates.map<AvailabilityPair>((product) => [
              product.id,
              undefined,
            ]);
          }
        })()
      : Promise.resolve([] as AvailabilityPair[]);
  const [offerAvailability, variantAvailability] = await Promise.all([
    offerAvailabilityPromise,
    variantAvailabilityPromise,
  ]);

  const offerAvailabilityById = new Map([
    ...offerAvailability,
    ...unresolvableOfferPairs,
  ]);
  const variantAvailabilityById = new Map(variantAvailability);
  let resolvedProducts = products.map((product) => {
    const offerResolution = offerAvailabilityById.get(product.id);
    const variantResolution = variantAvailabilityById.get(product.id);
    return {
      ...product,
      ...(offerResolution?.available !== undefined
        ? { has_purchasable_condition_offer: offerResolution.available }
        : {}),
      ...(offerResolution?.offers ? { offers: offerResolution.offers } : {}),
      ...(variantResolution?.available !== undefined
        ? { has_purchasable_variant: variantResolution.available }
        : {}),
      ...(variantResolution?.variants
        ? { variants: variantResolution.variants }
        : {}),
    };
  });

  if (canResolveSerializedInventory && merchantId) {
    try {
      const serializedProducts =
        await hydrateRelatedBlogProductSerializedInventory(
          supabase,
          merchantId,
          resolvedProducts.filter((product) => isValidUuid(product.id))
        );
      resolvedProducts = mergeRelatedBlogProductSerializedInventory(
        resolvedProducts,
        serializedProducts
      );
    } catch (error) {
      availabilityErrors.push(error);
      console.warn('Related blog product serialized availability unavailable', {
        merchantId,
        error,
      });
      // The production variant RPC does not project
      // inventory_tracking_policy, so a provisional `false` may come from an
      // exhausted serialized_then_unlimited row the stock-only first pass
      // could not recognize. Discard suspect provisionals rather than
      // reporting an unlimited product unavailable; stocked (`true`)
      // provisionals are safe under every policy.
      resolvedProducts = resolvedProducts.map((product) =>
        product.has_purchasable_variant === false
          ? { ...product, has_purchasable_variant: undefined }
          : product
      );
    }
  }

  if (options.throwOnError && availabilityErrors.length > 0) {
    throw availabilityErrors[0];
  }

  return resolvedProducts;
}
