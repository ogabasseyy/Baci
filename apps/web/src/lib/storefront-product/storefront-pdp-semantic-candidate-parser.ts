import type { ProductSemanticCandidate } from '@/lib/storefront-product/product-semantic-types';
import type { Json } from '@/types/supabase';
import {
  mergeProductCandidates,
  type ProductSeoRow,
  toProductSemanticCandidate,
} from './get-product-seo-link-inventory-normalize';

export function isJsonObject(
  value: Json
): value is Record<string, Json | undefined> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toProductSemanticCandidateFromJson(
  value: Json,
  categorySlug: string
): ProductSemanticCandidate | null {
  if (!isJsonObject(value)) return null;

  const categoryValue = value.categories;
  let categories: ProductSeoRow['categories'] = null;
  if (categoryValue !== null && categoryValue !== undefined) {
    if (!isJsonObject(categoryValue)) return null;
    const joinedSlug = categoryValue.slug;
    if (joinedSlug !== null && typeof joinedSlug !== 'string') return null;
    categories = { slug: joinedSlug };
  }

  const price = value.price;
  const stock = value.stock;
  const stockQuantity = value.stock_quantity;
  if (
    price !== null &&
    typeof price !== 'number' &&
    typeof price !== 'string'
  ) {
    return null;
  }
  if (stock !== null && stock !== undefined && typeof stock !== 'number') {
    return null;
  }
  if (
    stockQuantity !== null &&
    stockQuantity !== undefined &&
    typeof stockQuantity !== 'number'
  ) {
    return null;
  }

  let manageStock: boolean | null | undefined;
  if ('manage_stock' in value) {
    const rawManageStock = value.manage_stock;
    if (
      rawManageStock !== null &&
      rawManageStock !== undefined &&
      typeof rawManageStock !== 'boolean'
    ) {
      return null;
    }
    manageStock = rawManageStock;
  }

  let hasConditionOffers: boolean | null | undefined;
  if ('has_condition_offers' in value) {
    const rawOffers = value.has_condition_offers;
    if (
      rawOffers !== null &&
      rawOffers !== undefined &&
      typeof rawOffers !== 'boolean'
    ) {
      return null;
    }
    hasConditionOffers = rawOffers;
  }

  return toProductSemanticCandidate(
    {
      id: typeof value.id === 'string' ? value.id : null,
      brand: typeof value.brand === 'string' ? value.brand : null,
      categories,
      category: typeof value.category === 'string' ? value.category : null,
      condition: typeof value.condition === 'string' ? value.condition : null,
      name: typeof value.name === 'string' ? value.name : null,
      price,
      product_key_specs: value.product_key_specs,
      slug: typeof value.slug === 'string' ? value.slug : null,
      stock,
      stock_quantity: stockQuantity,
      manage_stock: manageStock,
      has_condition_offers: hasConditionOffers,
    },
    categorySlug
  );
}

export function parseInventory(
  value: Json | null,
  categorySlug: string
): ProductSemanticCandidate[] | null {
  if (!Array.isArray(value)) return null;
  const candidates = value.map((row) =>
    toProductSemanticCandidateFromJson(row, categorySlug)
  );
  return candidates.every(
    (candidate): candidate is ProductSemanticCandidate => candidate !== null
  )
    ? mergeProductCandidates(candidates)
    : null;
}
