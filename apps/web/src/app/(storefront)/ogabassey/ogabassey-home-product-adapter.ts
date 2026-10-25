import type { StorefrontHomeProduct } from '@/lib/cached-data';
import {
  PRODUCT_STATUS_ACTIVE,
  type Product,
  type ProductCondition,
  type ProductImage,
} from '@/lib/products';

const PRODUCT_CONDITION_VALUES = [
  'new',
  'used',
  'open_box',
  'refurbished',
] as const satisfies readonly ProductCondition[];

const PRODUCT_CONDITIONS = new Set<string>(PRODUCT_CONDITION_VALUES);

function isProductCondition(value: unknown): value is ProductCondition {
  return typeof value === 'string' && PRODUCT_CONDITIONS.has(value);
}

function getNullableNumber(
  value: number | null | undefined
): number | undefined {
  return value ?? undefined;
}

function getPriceNumber(value: StorefrontHomeProduct['price']): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function mapHomeProductImage(
  image: unknown,
  fallbackAlt: string,
  fallbackOrder: number
): ProductImage | null {
  if (typeof image === 'string') {
    const url = image.trim();
    return url ? { url, alt: fallbackAlt, order: fallbackOrder } : null;
  }

  if (!image || typeof image !== 'object' || !('url' in image)) {
    return null;
  }

  const candidate = image as Record<string, unknown>;
  if (typeof candidate.url !== 'string' || !candidate.url.trim()) {
    return null;
  }

  return {
    url: candidate.url.trim(),
    alt: typeof candidate.alt === 'string' ? candidate.alt : fallbackAlt,
    order:
      typeof candidate.order === 'number' ? candidate.order : fallbackOrder,
  };
}

function mapHomeProductImages(product: StorefrontHomeProduct): ProductImage[] {
  if (!Array.isArray(product.images)) {
    return [];
  }

  return product.images.flatMap((image, index) => {
    const mappedImage = mapHomeProductImage(image, product.name, index);
    return mappedImage ? [mappedImage] : [];
  });
}

function getFirstHomeProductCategory(
  categoryRelation: unknown
): Record<string, unknown> | null {
  const category = Array.isArray(categoryRelation)
    ? categoryRelation[0]
    : categoryRelation;

  if (!category || typeof category !== 'object') {
    return null;
  }

  return category as Record<string, unknown>;
}

function mapHomeProductCategory(
  product: StorefrontHomeProduct
): Product['categories'] {
  const category =
    getFirstHomeProductCategory(
      (product as StorefrontHomeProduct & { categories?: unknown }).categories
    ) ??
    getFirstHomeProductCategory(product.product_categories?.[0]?.categories);

  if (!category) {
    return null;
  }

  return {
    id: typeof category.id === 'string' ? category.id : undefined,
    name: typeof category.name === 'string' ? category.name : undefined,
    slug: typeof category.slug === 'string' ? category.slug : undefined,
    parent_id:
      typeof category.parent_id === 'string' ? category.parent_id : undefined,
  };
}

export function mapHomeProductsToTemplateProducts(
  products: StorefrontHomeProduct[]
): Product[] {
  return products.map((product) => {
    const images = product.advertised_image
      ? [{ url: product.advertised_image, alt: product.name, order: 0 }]
      : mapHomeProductImages(product);
    const primaryImage = images[0]?.url || '';
    const category = mapHomeProductCategory(product);

    return {
      id: product.id,
      name: product.name,
      slug: product.slug ?? undefined,
      description: product.description || '',
      status: PRODUCT_STATUS_ACTIVE,
      price: product.advertised_price ?? getPriceNumber(product.price),
      compare_at_price: getNullableNumber(
        product.advertised_price !== undefined
          ? product.advertised_compare_at_price
          : product.compare_at_price
      ),
      manage_stock: product.manage_stock ?? false,
      stock: product.stock_quantity ?? product.stock ?? 0,
      image: primaryImage,
      imageLarge: primaryImage,
      imageHint: product.brand || product.name,
      brand: product.brand || '',
      // The homepage query intentionally omits GTIN/MPN to keep the first
      // render payload small; detail/catalog queries still load identifiers.
      gtin: '',
      mpn: '',
      category: product.category ?? undefined,
      category_slug: category?.slug,
      categories: category,
      condition: isProductCondition(
        product.advertised_condition ?? product.condition
      )
        ? ((product.advertised_condition ??
            product.condition) as ProductCondition)
        : undefined,
      ...(product.has_condition_offers ? { has_condition_offers: true } : {}),
      ...(typeof product.has_variants === 'boolean'
        ? { has_variants: product.has_variants }
        : {}),
      ...(product.variant_model === 'sku_matrix' ||
      product.variant_model === 'legacy'
        ? { variant_model: product.variant_model }
        : {}),
      images,
      low_stock_threshold: getNullableNumber(product.low_stock_threshold),
    };
  });
}
