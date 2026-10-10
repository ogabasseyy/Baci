import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import type { Product as CartProduct } from '@/lib/products';
import type { Product } from '../../types';

function normalizeRelatedProductCondition(
  condition?: Product['condition']
): CartProduct['condition'] {
  if (!condition) {
    return undefined;
  }

  return normalizeCanonicalProductCondition(condition) || undefined;
}

function parseRelatedProductPrice(product: Product): number {
  if (
    typeof product.rawPrice === 'number' &&
    Number.isFinite(product.rawPrice)
  ) {
    return product.rawPrice;
  }

  const parsedPrice = Number.parseFloat(
    String(product.price).replace(/[^0-9.]/g, '')
  );

  return Number.isFinite(parsedPrice) ? parsedPrice : 0;
}

export function toRelatedProductsProduct(product: Product): CartProduct {
  const primaryImage =
    product.images?.[0] || product.image || '/placeholder.svg';

  return {
    id: String(product.id),
    merchant_id: product.merchantId,
    name: product.name,
    description: product.description || '',
    status: 'active',
    price: parseRelatedProductPrice(product),
    manage_stock: product.manage_stock ?? true,
    stock: product.stock ?? 0,
    image: primaryImage,
    imageLarge: primaryImage,
    imageHint: product.brand || product.name,
    brand: product.brand || '',
    gtin: '',
    mpn: '',
    slug: product.slug,
    category: product.category || product.categories?.name || '',
    category_slug: product.categorySlug || product.categories?.slug || '',
    categories: product.categories
      ? {
          id: product.categories.id,
          name: product.categories.name,
          slug: product.categories.slug,
          parent_id: product.categories.parent_id ?? undefined,
        }
      : null,
    condition: normalizeRelatedProductCondition(product.condition),
  };
}
