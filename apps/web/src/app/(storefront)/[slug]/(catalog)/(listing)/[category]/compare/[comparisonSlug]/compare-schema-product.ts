import {
  isExternalPlaceholderImageUrl,
  PLACEHOLDER_IMAGE,
} from '@/lib/image-utils';
import { normalizeOgabasseyCdnImageUrl } from '@/lib/ogabassey-cdn-image-url';
import type { buildProductCompareItemListSchema } from '@/lib/storefront-compare/compare-schema';

export type ProductCompareSchemaProduct = Parameters<
  typeof buildProductCompareItemListSchema
>[0]['products'][number];

export function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeStructuredDataImageUrl(
  value: string,
  baseUrl: string
): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === PLACEHOLDER_IMAGE) {
    return '';
  }

  try {
    const url = new URL(trimmed, baseUrl);
    const isHttpImage = url.protocol === 'http:' || url.protocol === 'https:';
    const absoluteImageUrl = url.toString();
    const isPlaceholder =
      url.pathname === PLACEHOLDER_IMAGE ||
      url.pathname.endsWith(PLACEHOLDER_IMAGE) ||
      isExternalPlaceholderImageUrl(absoluteImageUrl);

    return isHttpImage && !isPlaceholder
      ? normalizeOgabasseyCdnImageUrl(absoluteImageUrl)
      : '';
  } catch {
    return '';
  }
}

export function getStructuredDataImage(
  product: Record<string, unknown>,
  baseUrl: string
): string {
  if (typeof product.image === 'string') {
    const image = normalizeStructuredDataImageUrl(product.image, baseUrl);
    if (image) {
      return image;
    }
  }

  if (!Array.isArray(product.images)) {
    return '';
  }

  for (const image of product.images) {
    if (typeof image === 'string') {
      const imageUrl = normalizeStructuredDataImageUrl(image, baseUrl);
      if (imageUrl) {
        return imageUrl;
      }
    }

    const imageRecord = getRecord(image);
    if (typeof imageRecord?.url === 'string') {
      const imageUrl = normalizeStructuredDataImageUrl(
        imageRecord.url,
        baseUrl
      );
      if (imageUrl) {
        return imageUrl;
      }
    }
  }

  return '';
}

export function toOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function hasStockField(product: Record<string, unknown>): boolean {
  return 'stock_quantity' in product || 'stock' in product;
}

function isUnmanagedStructuredDataStock(
  product: Record<string, unknown>
): boolean {
  if ('manage_stock' in product) {
    return product.manage_stock == null || product.manage_stock === false;
  }

  // Storefront read contract: legacy rows with stock columns but no
  // manage_stock flag are unmanaged, not tracked zero-stock products.
  return hasStockField(product);
}

export function getStructuredDataAvailability(
  product: Record<string, unknown>
): ProductCompareSchemaProduct['availability'] {
  if (
    product.availability === 'InStock' ||
    product.availability === 'OutOfStock'
  ) {
    return product.availability;
  }

  if (typeof product.availability === 'string') {
    const normalized = product.availability.toLowerCase();
    if (
      normalized.includes('outofstock') ||
      normalized.includes('out_of_stock')
    ) {
      return 'OutOfStock';
    }
    if (normalized.includes('instock') || normalized.includes('in_stock')) {
      return 'InStock';
    }
  }

  if (typeof product.status === 'string') {
    const normalizedStatus = product.status.toLowerCase();
    if (
      normalizedStatus === 'out_of_stock' ||
      normalizedStatus === 'sold_out'
    ) {
      return 'OutOfStock';
    }
  }

  if (typeof product.in_stock === 'boolean') {
    return product.in_stock ? 'InStock' : 'OutOfStock';
  }

  if (isUnmanagedStructuredDataStock(product)) {
    return 'InStock';
  }

  const stockQuantity =
    toOptionalNumber(product.stock_quantity) ?? toOptionalNumber(product.stock);
  if (stockQuantity !== null) {
    return stockQuantity > 0 ? 'InStock' : 'OutOfStock';
  }

  return undefined;
}

function getStructuredDataCategories(
  value: unknown
): ProductCompareSchemaProduct['categories'] {
  const category = getRecord(value);
  if (!category) {
    return null;
  }

  const name =
    typeof category.name === 'string' && category.name.trim()
      ? category.name.trim()
      : undefined;
  const slug =
    typeof category.slug === 'string' && category.slug.trim()
      ? category.slug.trim()
      : undefined;

  return name || slug ? { name, slug } : null;
}

function truncateBrand(rawBrand: string, maxCodePoints = 70): string {
  const trimmed = rawBrand.trim();
  if (!trimmed) return '';
  const segments =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? Array.from(
          new Intl.Segmenter().segment(trimmed),
          (entry) => entry.segment
        )
      : Array.from(trimmed);
  let result = '';
  let count = 0;
  for (const segment of segments) {
    const segmentLength = Array.from(segment).length;
    if (count + segmentLength > maxCodePoints) break;
    result += segment;
    count += segmentLength;
  }
  return result;
}

export function toProductCompareSchemaProduct(
  product: unknown,
  baseUrl: string
): ProductCompareSchemaProduct | null {
  const record = getRecord(product);
  if (!record) return null;

  const id =
    typeof record.id === 'string' || typeof record.id === 'number'
      ? String(record.id)
      : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const image = getStructuredDataImage(record, baseUrl);
  const canonicalUrl =
    typeof record.canonical_url === 'string' && record.canonical_url.trim()
      ? record.canonical_url.trim()
      : null;
  const categories = getStructuredDataCategories(record.categories);

  if (!id || !name || !image) {
    return null;
  }

  const brand =
    typeof record.brand === 'string' ? truncateBrand(record.brand, 70) : '';

  return {
    id,
    name,
    ...(brand && { brand }),
    image,
    availability: getStructuredDataAvailability(record),
    category: typeof record.category === 'string' ? record.category : null,
    category_slug:
      typeof record.category_slug === 'string' ? record.category_slug : null,
    ...(canonicalUrl && { canonical_url: canonicalUrl }),
    ...(categories && { categories }),
    description:
      typeof record.description === 'string' ? record.description : null,
    price: toOptionalNumber(record.price),
    slug: typeof record.slug === 'string' ? record.slug : undefined,
  };
}
