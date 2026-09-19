import type { SupabaseClient } from '@supabase/supabase-js';
import { hasStockedRelatedBlogVariant } from '@/lib/has-stocked-related-blog-variant';
import { hydrateRelatedBlogProductSerializedInventory } from '@/lib/hydrate-related-blog-product-serialized-inventory';
import { mergeRelatedBlogProductSerializedInventory } from '@/lib/merge-related-blog-product-serialized-inventory';
import { getEffectiveStock } from '@/lib/product-stock';
import type {
  RelatedBlogProduct,
  RelatedBlogProductOffer,
  RelatedBlogProductVariant,
} from '@/lib/related-blog-products';
import { isValidUuid } from '@/lib/sanitize-core';

interface OfferStockRow {
  compare_at_price?: number | string | null;
  price?: number | string | null;
  status?: string | null;
  stock_quantity?: number | string | null;
}
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
function toFinitePrice(value: unknown): number | null {
  const price =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : null;
  return typeof price === 'number' && Number.isFinite(price) && price >= 0
    ? price
    : null;
}
function isOfferStockRow(value: unknown): value is OfferStockRow {
  return typeof value === 'object' && value !== null;
}
function hasStockedOffer(data: unknown): boolean {
  return (
    Array.isArray(data) &&
    data.some((offer) => isOfferStockRow(offer) && getEffectiveStock(offer) > 0)
  );
}
function normalizeOfferRows(data: unknown): RelatedBlogProductOffer[] {
  if (!Array.isArray(data)) return [];

  return data.flatMap((offer) => {
    if (!isOfferStockRow(offer)) return [];
    const price = toFinitePrice(offer.price);
    const compareAtPrice = toFinitePrice(offer.compare_at_price);
    return [
      {
        ...(price !== null ? { price } : {}),
        ...(compareAtPrice !== null
          ? { compare_at_price: compareAtPrice }
          : {}),
        status: offer.status ?? 'active',
        stock_quantity: toFinitePrice(offer.stock_quantity),
      },
    ];
  });
}
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

  const offerAvailabilityPromise: Promise<AvailabilityPair[]> = Promise.all(
    offerCandidates.map(async (product) => {
      try {
        const { data, error } = await supabase.rpc('get_product_offers', {
          p_product_id: product.id,
        });

        if (error) {
          availabilityErrors.push(error);
          console.warn('Related blog product offer availability unavailable', {
            productId: product.id,
            error,
          });
          return [product.id, undefined] as const;
        }

        return [
          product.id,
          {
            available: hasStockedOffer(data),
            offers: normalizeOfferRows(data),
          },
        ] as const;
      } catch (error) {
        availabilityErrors.push(error);
        console.warn('Related blog product offer availability unavailable', {
          productId: product.id,
          error,
        });
        return [product.id, undefined] as const;
      }
    })
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

  const offerAvailabilityById = new Map(offerAvailability);
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
    }
  }

  if (options.throwOnError && availabilityErrors.length > 0) {
    throw availabilityErrors[0];
  }

  return resolvedProducts;
}
