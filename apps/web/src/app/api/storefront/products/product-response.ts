import { normalizeProduct, type RawDbProduct } from '@/lib/normalize-product';
import {
  coerceStorefrontManageStock,
  getStorefrontAgentAvailability,
} from '@/lib/storefront-agent-availability';
import { buildStorefrontProductListingDescription } from '@/lib/storefront-product-listing-description';

export { STOREFRONT_PRODUCTS_FULL_SELECT } from '@/lib/storefront-products-full-select';
export { STOREFRONT_PRODUCTS_COMPACT_SELECT } from '@/lib/storefront-products-select';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mapStorefrontProduct(p: RawDbProduct) {
  const normalized = normalizeProduct(p);
  const manageStock = coerceStorefrontManageStock(p.manage_stock);
  const agentAvailability = getStorefrontAgentAvailability({
    manage_stock: manageStock,
    stock: p.stock,
    stock_quantity: p.stock_quantity,
    low_stock_threshold: p.low_stock_threshold,
  });
  const hasProjectedInStock =
    typeof p.advertised_price === 'number' && p.availability === 'InStock';
  const availability = hasProjectedInStock
    ? 'in_stock'
    : agentAvailability.availability;
  const isPurchasable = hasProjectedInStock
    ? true
    : agentAvailability.is_purchasable;
  const quantityAvailable = hasProjectedInStock
    ? Math.max(agentAvailability.quantity_available ?? 0, 1)
    : agentAvailability.quantity_available;

  type ImageInput = string | { url?: string; alt?: string; order?: number };
  const rawImages = (p.images as ImageInput[]) || [];
  const baseImages = rawImages.map((img, index) => {
    if (typeof img === 'string') {
      return { url: img, alt: normalized.name, order: index };
    }

    return {
      url: img.url || '',
      alt: img.alt || normalized.name,
      order: img.order ?? index,
    };
  });
  const advertisedImage =
    typeof p.advertised_image === 'string' && p.advertised_image.trim()
      ? p.advertised_image.trim()
      : undefined;
  const processedImages = advertisedImage
    ? [
        { url: advertisedImage, alt: normalized.name, order: 0 },
        ...baseImages
          .filter((img) => img.url !== advertisedImage)
          .map((img, index) => ({ ...img, order: index + 1 })),
      ]
    : baseImages;

  return {
    id: normalized.id,
    updated_at: p.updated_at,
    name: normalized.name,
    description: buildStorefrontProductListingDescription({
      brand: normalized.brand,
      category: normalized.category,
      description: normalized.description,
      name: normalized.name,
    }),
    price: normalized.price,
    compare_at_price: normalized.compare_at_price,
    image: normalized.image,
    imageLarge: normalized.imageLarge,
    rating: normalized.rating,
    availability,
    inventory_policy: agentAvailability.inventory_policy,
    is_purchasable: isPurchasable,
    quantity_available: quantityAvailable,
    category: normalized.category,
    category_slug: normalized.category_slug,
    brand: normalized.brand || '',
    stock: normalized.stock,
    slug: normalized.slug,
    status: normalized.status || 'active',
    condition: normalized.condition,
    imageHint: (p.image_hint as string) || '',
    images: processedImages,
    has_variants: p.has_variants,
    sku: p.sku,
    manage_stock: manageStock,
    low_stock_threshold: p.low_stock_threshold,
    specifications: p.specifications,
    product_key_specs: normalized.product_key_specs,
    has_condition_offers: p.has_condition_offers,
    offers: p.offers,
    colors:
      (typeof p.color === 'string' && p.color ? [p.color] : undefined) ||
      (isPlainObject(p.color_images) ? Object.keys(p.color_images) : []),
    variant_attributes: p.variant_attributes,
    categories:
      (p.categories as { id?: string; name?: string; slug?: string } | null) ??
      null,
    category_id: p.category_id as string | undefined,
  };
}
