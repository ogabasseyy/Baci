import { normalizeProductConditionOffers } from '@/components/storefront/ogabassey/pdp/normalize-product-condition-offers';
import { buildOgabasseyProductSpecData } from '@/components/storefront/ogabassey/product-spec-data';
import {
  normalizeProductCondition,
  type Product as OgabasseyProduct,
} from '@/components/storefront/ogabassey/types';
import type { VariantAttributeSource } from '@/components/storefront/ogabassey/variant-attributes';
import {
  getRenderableVariantAxes,
  mergeVariantAxisOptions,
  normalizeVariantAttributes,
} from '@/components/storefront/ogabassey/variant-attributes';
import type { CurrencyConfig } from '@/lib/currency';
import type { Product } from '@/lib/products';
import { getPdpPriceFormatter } from './pdp-price-formatter';

/** Converts server-side Product data to the Ogabassey template format. */
export function toOgabasseyProduct(
  product: Product,
  currency: CurrencyConfig
): OgabasseyProduct {
  // Format price in the merchant's own currency AND locale.
  const formatter = getPdpPriceFormatter(currency);

  // Production data currently stores variant_attributes as either:
  // 1. a legacy object map { Storage: ['256GB'] }
  // 2. an array of { param: 'storage', options: ['256GB'] }
  // Normalize both shapes before building storefront selectors.
  const rawVariantAttributes = (product as { variant_attributes?: unknown })
    .variant_attributes as VariantAttributeSource;
  const normalizedVariantAttributes =
    normalizeVariantAttributes(rawVariantAttributes);
  const mergedVariantAxisOptions = mergeVariantAxisOptions(
    product.variants,
    rawVariantAttributes,
    product.condition
  );
  const { detailedSpecs, specs } = buildOgabasseyProductSpecData({
    ...product,
    variant_attributes: normalizedVariantAttributes,
  });

  // Derive storage options - check multiple sources.
  // Priority: explicit storage_options > normalized variant attributes > variants.
  const storageOptions =
    product.storage_options && product.storage_options.length > 0
      ? product.storage_options
      : mergedVariantAxisOptions.storage || [];

  // Compute attributeAxes from both denormalized metadata and actual variants.
  // This keeps selectors visible when variant rows are incomplete, while still
  // allowing public storefront queries to enrich pricing/availability once RLS permits them.
  const attributeAxes = getRenderableVariantAxes(
    product.variants,
    rawVariantAttributes,
    product.condition
  );

  return {
    id: product.id,
    merchantId: product.merchant_id,
    slug: product.slug,
    name: product.name,
    price: formatter.format(product.price),
    rawPrice: product.price,
    image: product.imageLarge || product.image,
    // Handle both string arrays and object arrays with url property.
    images:
      product.images?.map((img) => (typeof img === 'string' ? img : img.url)) ||
      [product.imageLarge || product.image].filter(Boolean),
    description: product.description,
    rating: product.rating ?? 0,
    // Use category from Product which is already resolved from join or TEXT field.
    category: product.categories?.name || product.category || 'General',
    categorySlug: product.category_slug,
    condition: (product.condition || 'new') as OgabasseyProduct['condition'],
    brand: product.brand,
    stock: product.stock,
    manage_stock: product.manage_stock,
    storage: storageOptions,
    colors: product.colors,
    variant_attributes: normalizedVariantAttributes,
    attributeAxes: attributeAxes.length > 0 ? attributeAxes : undefined,
    detailedSpecs,
    specs,
    variants:
      product.variants?.map(
        (v: {
          id: string;
          sku?: string;
          attributes?: Record<string, string>;
          condition?: string | null;
          price_override?: number;
          price_modifier?: number;
          inventory_tracking_policy?: string | null;
          primary_image?: string | null;
          stock_quantity?: number;
          images?: string[];
        }) => {
          const storage = v.attributes?.storage;
          const ram = v.attributes?.ram;
          const color = v.attributes?.color;
          const platform = v.attributes?.platform;

          return {
            id: v.id,
            name: `${storage || ''} ${ram || ''}`.trim() || v.sku || 'Variant',
            storage,
            ram,
            color,
            condition: normalizeProductCondition(v.condition),
            platform,
            attributes: v.attributes,
            price_override: v.price_override,
            price_modifier: v.price_modifier,
            inventory_tracking_policy: v.inventory_tracking_policy,
            primary_image: v.primary_image,
            // Keep legacy `stock` and canonical `stock_quantity` consumers in sync.
            stock: v.stock_quantity,
            stock_quantity: v.stock_quantity,
            images: v.images,
          };
        }
      ) || [],
    has_condition_offers: product.has_condition_offers,
    offers: normalizeProductConditionOffers(product.offers, (value) =>
      formatter.format(value)
    ),
  };
}
