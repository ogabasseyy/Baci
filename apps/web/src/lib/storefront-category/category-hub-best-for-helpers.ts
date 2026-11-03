import type { CategoryHubProduct } from '@/lib/storefront-category/category-hub-types';

export function getSpecNumber(
  product: CategoryHubProduct,
  key: string
): number | null {
  const value = product.product_key_specs?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function isProductAvailable(product: CategoryHubProduct): boolean {
  if (!Number.isFinite(product.price) || product.price <= 0) return false;
  if (product.manage_stock === false || product.manage_stock == null)
    return true;
  if (product.stock == null) return true;
  if (product.stock > 0) return true;
  return Boolean(product.has_condition_offers);
}

export function pickRepresentativeProduct(
  products: CategoryHubProduct[],
  comparator: (left: CategoryHubProduct, right: CategoryHubProduct) => number
): CategoryHubProduct | null {
  return products.length > 0 ? [...products].sort(comparator)[0] : null;
}

export function compareByPriceAsc(
  left: CategoryHubProduct,
  right: CategoryHubProduct
): number {
  return (
    left.price - right.price ||
    left.name.localeCompare(right.name) ||
    left.slug.localeCompare(right.slug)
  );
}

export function compareBySpecDescThenPriceAsc(
  specKey: string
): (left: CategoryHubProduct, right: CategoryHubProduct) => number {
  return (left, right) =>
    (getSpecNumber(right, specKey) ?? 0) -
      (getSpecNumber(left, specKey) ?? 0) ||
    left.price - right.price ||
    left.name.localeCompare(right.name) ||
    left.slug.localeCompare(right.slug);
}
