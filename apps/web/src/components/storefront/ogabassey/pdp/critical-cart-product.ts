import type {
  Product as CartProduct,
  ProductCondition,
} from '@/lib/products';

const VALID_CART_CONDITIONS = new Set<ProductCondition>([
  'new',
  'used',
  'open_box',
  'refurbished',
]);

type CriticalCartSource = Pick<
  CartProduct,
  | 'available_conditions'
  | 'brand'
  | 'category'
  | 'category_slug'
  | 'compare_at_price'
  | 'condition'
  | 'default_variant_id'
  | 'description'
  | 'gtin'
  | 'has_variants'
  | 'id'
  | 'image'
  | 'imageHint'
  | 'imageLarge'
  | 'manage_stock'
  | 'mpn'
  | 'name'
  | 'offers'
  | 'price'
  | 'slug'
  | 'status'
  | 'stock'
  | 'variants'
>;

function normalizeCartCondition(
  condition: ProductCondition | string | null | undefined
): ProductCondition | undefined {
  if (!condition) return undefined;
  return VALID_CART_CONDITIONS.has(condition as ProductCondition)
    ? (condition as ProductCondition)
    : undefined;
}

export function createCriticalCartProduct(
  product: CriticalCartSource
): CartProduct {
  return {
    available_conditions: product.available_conditions,
    brand: product.brand || 'OgaBassey',
    category: product.category,
    category_slug: product.category_slug,
    compare_at_price: product.compare_at_price,
    condition: normalizeCartCondition(product.condition),
    default_variant_id: product.default_variant_id,
    description: product.description || product.name,
    gtin: product.gtin || '',
    has_variants: product.has_variants,
    id: product.id,
    image: product.image,
    imageHint: product.imageHint || product.name,
    imageLarge: product.imageLarge || product.image,
    // NULL means managed (platform policy): only explicit false
    // disables the cart out-of-stock guard.
    manage_stock: product.manage_stock ?? true,
    mpn: product.mpn || product.slug || product.id,
    name: product.name,
    offers: product.offers,
    price: product.price,
    slug: product.slug,
    status: product.status,
    stock: Math.max(0, product.stock || 0),
    variants: product.variants,
  };
}
