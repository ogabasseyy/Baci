import { normalizeProductInventory } from '@baci/shared';
import { createLogger } from '@/lib/logger';
import { normalizeProductConditionFilterValue } from '@/lib/product-filter-options';
import {
  getPrimaryProductImage,
  normalizeProductImages,
  normalizeProductSpecifications,
} from '@/lib/product-normalization';
import { resolveProductVariantMetadata } from '@/lib/product-variant-metadata';
import { ProductRowSchema } from '@/lib/validation';
import {
  formatProductConditionDisplay,
  type Product,
  type ProductVariant,
} from '@/types/product';
import type { Category } from './product-utils.types';
import { isVariantBearingProduct } from './product-variant-state';

const log = createLogger('Products');

function getMixedConditionLabel(availableConditions?: unknown) {
  if (!Array.isArray(availableConditions)) return 'Multiple Conditions';

  const labels = Array.from(
    new Set(
      availableConditions
        .map((condition) =>
          typeof condition === 'string'
            ? formatProductConditionDisplay(condition)
            : undefined
        )
        .filter(
          (
            value
          ): value is NonNullable<
            ReturnType<typeof formatProductConditionDisplay>
          > => Boolean(value)
        )
    )
  );

  if (labels.length === 0) return 'Multiple Conditions';
  return labels.length === 2 &&
    labels.includes('New') &&
    labels.includes('Used')
    ? 'New & Used'
    : 'Multiple Conditions';
}

function normalizeVariantAttributeMap(
  attributes: Record<string, unknown> | null | undefined
) {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (typeof value !== 'string') {
      continue;
    }

    // Variant attributes are selector labels; blank labels are not selectable.
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      continue;
    }

    normalized[key] = trimmedValue;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeProductVariants(
  variants: unknown,
  options: {
    basePrice: number;
    compareAtPrice?: number;
    manageStock?: boolean;
  }
): ProductVariant[] {
  const parsedVariants = ProductRowSchema.shape.variants.safeParse(variants);
  if (!parsedVariants.success) return [];
  const inventoryUnmanaged = options.manageStock === false;

  return (
    parsedVariants.data?.map((variant) => {
      const attributes = normalizeVariantAttributeMap(variant.attributes);
      const synthesizedName =
        [
          attributes?.storage,
          attributes?.ram,
          attributes?.color,
          attributes?.platform,
        ]
          .filter((value): value is string => Boolean(value))
          .join(' ')
          .trim() ||
        variant.sku ||
        variant.name ||
        'Variant';
      const primaryImage = variant.primary_image ?? variant.image ?? undefined;
      const images = normalizeProductImages(
        variant.images ?? (primaryImage ? [primaryImage] : undefined)
      );
      const stockQuantity = variant.stock_quantity ?? undefined;

      return {
        id: variant.id,
        name: synthesizedName,
        condition:
          normalizeProductConditionFilterValue(
            variant.condition ?? undefined
          ) ?? undefined,
        sku: variant.sku ?? undefined,
        price:
          variant.price ??
          variant.price_override ??
          (typeof variant.price_modifier === 'number'
            ? Math.max(0, options.basePrice + variant.price_modifier)
            : options.basePrice),
        compare_at_price:
          variant.compare_at_price ?? options.compareAtPrice ?? undefined,
        price_override: variant.price_override ?? undefined,
        price_modifier: variant.price_modifier ?? undefined,
        image: primaryImage,
        images: images.length > 0 ? images : undefined,
        in_stock: inventoryUnmanaged
          ? true
          : typeof stockQuantity === 'number'
            ? stockQuantity > 0
            : (variant.in_stock ?? undefined),
        stock_quantity: stockQuantity,
        effective_policy: variant.effective_policy ?? undefined,
        available_units: variant.available_units ?? undefined,
        attributes,
      };
    }) ?? []
  );
}

export function transformProduct(item: unknown): Product | null {
  const validated = ProductRowSchema.safeParse(item);
  if (!validated.success) {
    log.error('Product row validation failed during transform', {
      issues: validated.error.format(),
      item,
    });
    return null;
  }
  const product = validated.data;
  const images = normalizeProductImages(product.images);
  const rating = Number.isFinite(product.average_rating)
    ? (product.average_rating as number)
    : undefined;
  const reviewCount = Number.isFinite(product.review_count)
    ? Math.max(0, Math.trunc(product.review_count as number))
    : 0;
  const colorImages =
    product.color_images && typeof product.color_images === 'object'
      ? Object.fromEntries(
          Object.entries(product.color_images).map(([color, images]) => [
            color,
            normalizeProductImages(images),
          ])
        )
      : undefined;
  const variants = normalizeProductVariants(product.variants, {
    basePrice: Number(product.price ?? 0),
    compareAtPrice: product.compare_at_price ?? undefined,
    // Legacy NULL manage_stock is managed inventory (platform policy shared
    // with the categorized web PDP and the search price projection): only an
    // explicit false bypasses stock checks.
    manageStock: (product.manage_stock as boolean | undefined) ?? true,
  });
  const legacyScalarColor =
    typeof product.color === 'string' ? product.color.trim() : '';
  const colorsFromArray = Array.isArray(product.colors) ? product.colors : [];
  const productColorsForMetadata =
    colorsFromArray.length > 0
      ? colorsFromArray
      : legacyScalarColor
        ? [legacyScalarColor]
        : undefined;
  const variantMetadata = resolveProductVariantMetadata({
    colorImages,
    productImages: images,
    productColors: productColorsForMetadata,
    sourceVariantAttributes: product.variant_attributes,
    variants,
  });
  const inventory = normalizeProductInventory({
    stock: product.stock,
    stock_quantity: product.stock_quantity,
    manage_stock: product.manage_stock ?? true,
  });
  const galleryImages =
    variantMetadata.galleryImages && variantMetadata.galleryImages.length > 0
      ? variantMetadata.galleryImages
      : images;

  return {
    id: String(product.id ?? ''),
    name: String(product.name ?? ''),
    slug: String(product.slug ?? ''),
    description: product.description as string | undefined,
    price: Number(product.price ?? 0),
    compare_at_price: product.compare_at_price as number | undefined,
    created_at: product.created_at ?? undefined,
    image: galleryImages[0] ?? getPrimaryProductImage(product.images),
    images: galleryImages,
    brand: product.brand as string | undefined,
    category: Array.isArray(product.categories)
      ? product.categories.length > 0
        ? (product.categories[0] as Category).name
        : ''
      : product.categories != null
        ? (product.categories as unknown as Category).name
        : '',
    specifications: normalizeProductSpecifications(product.specifications),
    condition:
      Array.isArray(product.available_conditions) &&
      product.available_conditions.length > 1
        ? getMixedConditionLabel(product.available_conditions)
        : product.has_condition_offers
          ? 'New & Used'
          : formatProductConditionDisplay(product.condition),
    rating,
    review_count: reviewCount,
    manage_stock: (product.manage_stock as boolean) ?? true,
    stock_quantity: inventory.stock_quantity,
    base_effective_policy: product.base_effective_policy ?? undefined,
    base_available_units: product.base_available_units ?? undefined,
    colors: variantMetadata.colors,
    color_images: variantMetadata.colorImages,
    has_variants: isVariantBearingProduct(product),
    variant_model:
      product.variant_model === 'sku_matrix' ? 'sku_matrix' : 'legacy',
    available_conditions:
      Array.isArray(product.available_conditions) &&
      product.available_conditions.every((value) => typeof value === 'string')
        ? (product.available_conditions as Product['available_conditions'])
        : undefined,
    variant_attributes: variantMetadata.variantAttributes,
    variants,
    has_condition_offers: product.has_condition_offers ?? false,
    offers_hydration_failed: product.offers_hydration_failed ?? undefined,
    offers: Array.isArray(product.offers)
      ? product.offers.map((offer) => ({
          id: offer.id,
          condition: offer.condition as NonNullable<
            Product['offers']
          >[number]['condition'],
          price: offer.price,
          compare_at_price: offer.compare_at_price ?? undefined,
          stock_quantity: offer.stock_quantity ?? undefined,
          images: normalizeProductImages(offer.images),
          condition_notes: offer.condition_notes ?? undefined,
          grade: offer.grade ?? undefined,
        }))
      : undefined,
    in_stock: inventory.manage_stock === false || inventory.stock_quantity > 0,
  };
}
