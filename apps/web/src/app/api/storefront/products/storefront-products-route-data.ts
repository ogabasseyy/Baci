import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { normalizeProduct, type RawDbProduct } from '@/lib/normalize-product';
import {
  coerceStorefrontManageStock,
  getStorefrontAgentAvailability,
} from '@/lib/storefront-agent-availability';
import { buildStorefrontProductListingDescription } from '@/lib/storefront-product-listing-description';
import {
  STOREFRONT_PRODUCTS_COMPACT_SELECT,
  STOREFRONT_PRODUCTS_SELECT,
} from '@/lib/storefront-products-select';

export type RawStorefrontProductRow = Record<string, unknown>;
type ImageInput = string | { url?: string; alt?: string; order?: number };

function normalizeLegacyColorList(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const colors = value
    .split(',')
    .map((color) => color.trim())
    .filter(Boolean);

  return colors.length > 0 ? colors : undefined;
}

function mapProduct(product: RawStorefrontProductRow) {
  const normalized = normalizeProduct(product as RawDbProduct);
  const manageStock = coerceStorefrontManageStock(
    product.manage_stock as boolean | null | undefined
  );
  const agentAvailability = getStorefrontAgentAvailability({
    manage_stock: manageStock,
    stock: product.stock as number | string | null | undefined,
    stock_quantity: product.stock_quantity as
      | number
      | string
      | null
      | undefined,
    low_stock_threshold: product.low_stock_threshold as
      | number
      | string
      | null
      | undefined,
  });
  const rawImages = (product.images as ImageInput[]) || [];
  const colorImageKeys =
    typeof product.color_images === 'object' &&
    product.color_images !== null &&
    !Array.isArray(product.color_images)
      ? Object.keys(product.color_images as Record<string, unknown>).filter(
          Boolean
        )
      : [];
  const processedImages = rawImages.map((image, index) => {
    if (typeof image === 'string') {
      return { url: image, alt: (product.name as string) || '', order: index };
    }

    return {
      url: image.url || '',
      alt: image.alt || (product.name as string) || '',
      order: image.order ?? index,
    };
  });
  const categoryFilterSource = buildCategoryFilterSource(product);
  const categoryNames = Array.from(
    new Set(
      [
        categoryFilterSource.category,
        ...categoryFilterSource.categories.map(({ name }) => name),
      ].filter((category): category is string => Boolean(category?.trim()))
    )
  );

  return {
    id: normalized.id,
    updated_at: product.updated_at,
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
    category: normalized.category,
    category_slug: normalized.category_slug,
    category_names: categoryNames,
    brand: normalized.brand,
    availability: agentAvailability.availability,
    inventory_policy: agentAvailability.inventory_policy,
    is_purchasable: agentAvailability.is_purchasable,
    quantity_available: agentAvailability.quantity_available,
    stock: normalized.stock,
    slug: normalized.slug,
    status: normalized.status || 'active',
    condition: normalized.condition,
    imageHint: product.image_hint,
    images: processedImages,
    has_variants: product.has_variants,
    sku: product.sku,
    manage_stock: manageStock,
    low_stock_threshold: product.low_stock_threshold,
    specifications: product.specifications,
    product_key_specs:
      normalized.product_key_specs ?? product.product_key_specs,
    has_condition_offers:
      typeof product.has_condition_offers === 'boolean'
        ? product.has_condition_offers
        : false,
    available_conditions: Array.isArray(product.available_conditions)
      ? product.available_conditions.filter(
          (condition): condition is string => typeof condition === 'string'
        )
      : [],
    variant_model: product.variant_model,
    offers: product.offers,
    colors:
      colorImageKeys.length > 0
        ? colorImageKeys
        : normalizeLegacyColorList(product.color),
    variant_attributes: product.variant_attributes,
  };
}

function buildCategoryFilterSource(product: RawStorefrontProductRow) {
  const primaryCategory = Array.isArray(product.categories)
    ? product.categories[0]
    : product.categories;
  const relationCategories = Array.isArray(product.product_categories)
    ? product.product_categories.flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || !('categories' in entry)) {
          return [];
        }

        const category = entry.categories;
        return category && typeof category === 'object'
          ? [
              {
                name:
                  typeof category.name === 'string' ? category.name : undefined,
                slug:
                  typeof category.slug === 'string' ? category.slug : undefined,
              },
            ]
          : [];
      })
    : [];
  const normalizedPrimaryCategory =
    primaryCategory && typeof primaryCategory === 'object'
      ? [
          {
            name:
              typeof primaryCategory.name === 'string'
                ? primaryCategory.name
                : undefined,
            slug:
              typeof primaryCategory.slug === 'string'
                ? primaryCategory.slug
                : undefined,
          },
        ]
      : [];

  return {
    category: typeof product.category === 'string' ? product.category : null,
    categories: [...normalizedPrimaryCategory, ...relationCategories],
  };
}

function escapeLikePattern(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

function getConditionPrefilterClauses(condition: string) {
  const normalized = normalizeCanonicalProductCondition(condition);

  if (!normalized) {
    return [];
  }

  const rawConditions =
    normalized === 'open_box'
      ? ['open_box', 'refurbished']
      : normalized === 'used'
        ? ['used', 'uk_used']
        : ['new'];
  const clauses = new Set<string>();

  for (const rawCondition of rawConditions) {
    clauses.add(`condition.eq.${rawCondition}`);
    clauses.add(`available_conditions.cs.{${rawCondition}}`);
  }

  if (normalized === 'new' || normalized === 'used') {
    clauses.add('has_condition_offers.eq.true');
  }

  return Array.from(clauses);
}

export const storefrontProductsRouteData = {
  buildCategoryFilterSource,
  escapeLikePattern,
  getConditionPrefilterClauses,
  mapProduct,
  STOREFRONT_PRODUCTS_COMPACT_SELECT,
  STOREFRONT_PRODUCTS_SELECT,
} as const;
