import type { Product } from '@/lib/products';
import type { VariantAttributeSource } from '@/lib/storefront-specs/variant-attributes';

export interface PublicStorefrontProductVariant {
  attributes: Record<string, string> | null;
  available_units?: number | null;
  condition?: string | null;
  created_at?: string | null;
  effective_policy?: string | null;
  id: string;
  images?: unknown;
  price_override?: number | string | null;
  primary_image?: string | null;
  product_id: string;
  sku?: string | null;
  stock_quantity?: number | null;
  updated_at?: string | null;
}

interface CachedStorefrontProductOffer {
  condition: NonNullable<Product['condition']>;
  id: string;
  images?: string[];
  price: number | string | null;
  status: string;
  stock_quantity?: number | string | null;
}

type CachedStorefrontProductImage =
  | string
  | { alt?: string; order?: number; url: string };

export interface CachedProductLcpHint {
  base_price?: number | null;
  brand?: string | null;
  canonical_url?: string | null;
  category?: string | null;
  categories?:
    | { id: string; name: string; slug: string }
    | Array<{ id: string; name: string; slug: string }>
    | null;
  color?: string | null;
  condition?: string | null;
  compare_at_price?: number | string | null;
  default_variant_id?: string | null;
  has_variants?: boolean | null;
  id: string;
  images?: Array<string | { alt?: string | null; url: string }> | null;
  inventory_tracking_policy?: string | null;
  keywords?: string[] | null;
  manage_stock?: boolean | null;
  max_variant_price?: number | string | null;
  merchant_id?: string | null;
  meta_description?: string | null;
  meta_title?: string | null;
  min_variant_price?: number | string | null;
  name: string;
  price?: number | string | null;
  product_categories?: Array<{
    categories:
      | { id: string; name: string; slug: string }
      | Array<{ id: string; name: string; slug: string }>
      | null;
  }> | null;
  product_offers?: CachedStorefrontProductOffer[];
  product_variants?: PublicStorefrontProductVariant[] | null;
  sale_price?: number | null;
  schema_markup?: unknown;
  slug?: string | null;
  stock?: number | null;
  stock_quantity?: number | null;
  updated_at?: string | null;
  variant_attributes?: unknown;
}

export type CachedStorefrontPdpCore = Omit<
  CachedProductLcpHint,
  | 'brand'
  | 'category'
  | 'compare_at_price'
  | 'condition'
  | 'images'
  | 'max_variant_price'
  | 'merchant_id'
  | 'min_variant_price'
  | 'price'
  | 'product_categories'
  | 'product_variants'
  | 'schema_markup'
  | 'slug'
  | 'variant_attributes'
> & {
  brand?: string;
  category?: string;
  compare_at_price?: number;
  condition?: string;
  has_condition_offers?: boolean;
  images?: CachedStorefrontProductImage[];
  max_variant_price?: number;
  merchant_id?: string;
  min_variant_price?: number;
  offers: CachedStorefrontProductOffer[];
  price: number;
  product_key_specs?: unknown;
  product_categories?: Array<{
    categories: { id: string; name: string; slug: string } | null;
  }>;
  product_offers: CachedStorefrontProductOffer[];
  product_variants: PublicStorefrontProductVariant[];
  schema_markup?: Product['schema_markup'];
  slug: string;
  specifications?: Product['specifications'];
  status?: string;
  variant_attributes?: VariantAttributeSource;
  variant_model?: 'legacy' | 'sku_matrix' | null;
  [key: string]: unknown;
};

/** Converts the public PDP snapshot into the shared shape used by cached and uncached readers. */
export function normalizeCachedStorefrontPdpCore(
  product: Record<string, unknown>
): CachedStorefrontPdpCore | null {
  const id = typeof product.id === 'string' ? product.id : null;
  const name = typeof product.name === 'string' ? product.name : null;
  const storedSlug = typeof product.slug === 'string' ? product.slug : null;
  const price =
    typeof product.price === 'number' && Number.isFinite(product.price)
      ? product.price
      : null;
  if (!id || !name || price === null) return null;
  const slug = storedSlug || id;

  const productOffers = Array.isArray(product.product_offers)
    ? (product.product_offers as CachedStorefrontProductOffer[])
    : [];
  const images = Array.isArray(product.images)
    ? product.images.flatMap((image): CachedStorefrontProductImage[] => {
        if (typeof image === 'string') return [image];
        if (!image || typeof image !== 'object') return [];
        const url = Reflect.get(image, 'url');
        if (typeof url !== 'string') return [];
        const alt = Reflect.get(image, 'alt');
        const order = Reflect.get(image, 'order');
        return [
          {
            url,
            ...(typeof alt === 'string' ? { alt } : null),
            ...(typeof order === 'number' ? { order } : null),
          },
        ];
      })
    : undefined;

  return {
    ...product,
    id,
    name,
    slug,
    price,
    brand: typeof product.brand === 'string' ? product.brand : undefined,
    category:
      typeof product.category === 'string' ? product.category : undefined,
    compare_at_price:
      typeof product.compare_at_price === 'number'
        ? product.compare_at_price
        : undefined,
    condition:
      typeof product.condition === 'string' ? product.condition : undefined,
    has_condition_offers:
      typeof product.has_condition_offers === 'boolean'
        ? product.has_condition_offers
        : undefined,
    images,
    max_variant_price:
      typeof product.max_variant_price === 'number'
        ? product.max_variant_price
        : undefined,
    merchant_id:
      typeof product.merchant_id === 'string' ? product.merchant_id : undefined,
    min_variant_price:
      typeof product.min_variant_price === 'number'
        ? product.min_variant_price
        : undefined,
    offers: productOffers,
    product_categories: undefined,
    product_offers: productOffers,
    product_variants: Array.isArray(product.product_variants)
      ? (product.product_variants as PublicStorefrontProductVariant[])
      : [],
    schema_markup:
      product.schema_markup && typeof product.schema_markup === 'object'
        ? (product.schema_markup as Product['schema_markup'])
        : undefined,
    specifications: Array.isArray(product.specifications)
      ? (product.specifications as Product['specifications'])
      : undefined,
    status: typeof product.status === 'string' ? product.status : undefined,
    variant_attributes:
      product.variant_attributes === null ||
      Array.isArray(product.variant_attributes) ||
      (product.variant_attributes !== null &&
        typeof product.variant_attributes === 'object')
        ? (product.variant_attributes as VariantAttributeSource)
        : undefined,
  };
}
