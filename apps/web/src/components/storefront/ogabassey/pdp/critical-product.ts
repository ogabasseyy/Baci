type CategoryShape =
  | { id?: string | null; name?: string | null; slug?: string | null }
  | null
  | undefined;

type ProductImage = string | { alt?: string | null; url?: string | null };

const FALLBACK_PRODUCT_IMAGE = '/placeholder.png';
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export interface OgabasseyPdpCriticalProductInput {
  brand?: string | null;
  category?: string | null;
  category_slug?: string | null;
  categories?: CategoryShape | CategoryShape[];
  condition?: string | null;
  id: string;
  image?: string | null;
  imageLarge?: string | null;
  images?: ProductImage[] | null;
  name: string;
  price?: number | string | null;
  product_categories?: Array<{
    categories?: CategoryShape | CategoryShape[];
  }>;
  schema_markup?: unknown;
  slug?: string | null;
  stock_quantity?: number | null;
  updated_at?: string | null;
}

export interface OgabasseyPdpCriticalProduct {
  brand: string;
  categoryName: string;
  categorySlug: string;
  condition: string;
  id: string;
  image: string;
  imageVersion: string | null;
  name: string;
  price: number;
  rating: number;
  ratingCount: number;
  reviewCount: number;
  slug: string;
  stockQuantity: number | null;
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function firstCategory(value: CategoryShape | CategoryShape[]) {
  return Array.isArray(value) ? value[0] : value;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function stableHash(value: string): string {
  let hash = FNV_OFFSET_BASIS;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  return hash.toString(36);
}

function getAggregateRating(schemaMarkup: unknown) {
  if (!schemaMarkup || typeof schemaMarkup !== 'object') {
    return { rating: 0, ratingCount: 0, reviewCount: 0 };
  }

  const schema = schemaMarkup as {
    aggregateRating?: {
      bestRating?: unknown;
      ratingCount?: unknown;
      ratingValue?: unknown;
      reviewCount?: unknown;
      worstRating?: unknown;
    };
  };
  const ratingCount = parseNumber(schema.aggregateRating?.ratingCount);
  const reviewCount = parseNumber(schema.aggregateRating?.reviewCount);
  const bestRating =
    schema.aggregateRating?.bestRating === undefined ||
    schema.aggregateRating.bestRating === null
      ? 5
      : parseNumber(schema.aggregateRating.bestRating);
  const worstRating =
    schema.aggregateRating?.worstRating === undefined ||
    schema.aggregateRating.worstRating === null
      ? 1
      : parseNumber(schema.aggregateRating.worstRating);
  const rating = parseNumber(schema.aggregateRating?.ratingValue);

  if (worstRating !== 1 || bestRating !== 5 || rating < 1 || rating > 5) {
    return { rating: 0, ratingCount: 0, reviewCount: 0 };
  }

  return {
    rating,
    // Surface aggregate-only rating counts so ratingCount-backed JSON-LD does
    // not render as a zero-review/no-rating PDP shell.
    ratingCount: Math.max(ratingCount, reviewCount),
    reviewCount,
  };
}

export function getOgabasseyPdpPrimaryImage(
  product: Pick<
    OgabasseyPdpCriticalProductInput,
    'image' | 'imageLarge' | 'images'
  >
): string {
  const firstImage = Array.isArray(product.images) ? product.images[0] : null;
  const mappedFirstImage =
    typeof firstImage === 'string' ? firstImage : firstImage?.url || null;

  return (
    product.imageLarge ||
    product.image ||
    mappedFirstImage ||
    FALLBACK_PRODUCT_IMAGE
  );
}

export function getOgabasseyPdpImageVersion(
  product: Pick<
    OgabasseyPdpCriticalProductInput,
    'image' | 'imageLarge' | 'images' | 'updated_at'
  >
): string | null {
  const primaryImage = getOgabasseyPdpPrimaryImage(product);
  const parts = [product.updated_at, primaryImage]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part && part !== FALLBACK_PRODUCT_IMAGE);

  return parts.length ? stableHash(parts.join('|')) : null;
}

export function buildOgabasseyPdpCriticalProduct(
  product: OgabasseyPdpCriticalProductInput
): OgabasseyPdpCriticalProduct {
  const directCategory = firstCategory(product.categories);
  const fallbackCategory = firstCategory(
    product.product_categories?.[0]?.categories
  );
  const category = directCategory || fallbackCategory;
  const categoryName = category?.name || product.category || 'Electronics';
  const aggregateRating = getAggregateRating(product.schema_markup);
  const image = getOgabasseyPdpPrimaryImage(product);

  return {
    brand: product.brand || 'OgaBassey',
    categoryName,
    categorySlug:
      category?.slug || product.category_slug || slugify(categoryName),
    condition: product.condition || 'new',
    id: product.id,
    image,
    imageVersion: getOgabasseyPdpImageVersion(product),
    name: product.name,
    price: parseNumber(product.price),
    rating: aggregateRating.rating,
    ratingCount: aggregateRating.ratingCount,
    reviewCount: aggregateRating.reviewCount,
    slug: product.slug || product.id,
    stockQuantity:
      typeof product.stock_quantity === 'number'
        ? product.stock_quantity
        : null,
  };
}
