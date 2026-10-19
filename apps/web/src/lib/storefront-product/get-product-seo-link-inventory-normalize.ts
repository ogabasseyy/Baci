import { normalizeProductKeySpecs } from '@/lib/product-key-specs-normalize';
import { PRODUCT_KEY_SPECS_RELATION_SELECT } from '@/lib/product-key-specs-select';
import type { ProductSemanticCandidate } from '@/lib/storefront-product/product-semantic-types';

export interface ProductCategoryJoin {
  category_id?: string | null;
  categories?:
    | { slug?: string | null }
    | Array<{ slug?: string | null }>
    | null;
}

export interface ProductSeoRow {
  created_at?: string | null;
  id?: string | null;
  slug?: string | null;
  name?: string | null;
  brand?: string | null;
  condition?: string | null;
  price?: number | string | null;
  stock?: number | null;
  stock_quantity?: number | null;
  category?: string | null;
  category_id?: string | null;
  categories?:
    | { slug?: string | null }
    | Array<{ slug?: string | null }>
    | null;
  product_categories?: ProductCategoryJoin[] | null;
  product_key_specs?: unknown;
}

export function getProductSeoSelect(isCategoryScoped: boolean) {
  const productCategoriesSelect = isCategoryScoped
    ? 'product_categories!inner(category_id, categories(slug))'
    : 'product_categories(category_id, categories(slug))';
  return `
    id, slug, name, brand, condition, price, stock, stock_quantity, category, category_id, created_at,
    categories:category_id(slug),
    ${PRODUCT_KEY_SPECS_RELATION_SELECT},
    ${productCategoriesSelect}
  `;
}

export function normalizeCategorySlugForSearch(categorySlug: string): string {
  let decoded = categorySlug;
  try {
    decoded = decodeURIComponent(categorySlug);
  } catch {
    decoded = categorySlug;
  }
  return decoded
    .replace(/[-_]+/g, ' ')
    .replace(/[,().]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toProductSemanticCandidate(
  product: ProductSeoRow,
  fallbackCategorySlug: string
): ProductSemanticCandidate | null {
  const slug = product.slug?.trim();
  const name = product.name?.trim();
  const price = parseSemanticProductPrice(product.price);
  if (!slug || !name || price === null) {
    return null;
  }

  return {
    slug,
    name,
    brand: product.brand,
    condition: product.condition,
    price,
    stock: product.stock_quantity ?? product.stock,
    category_slug:
      getJoinedCategorySlug(product, fallbackCategorySlug) ??
      fallbackCategorySlug,
    product_key_specs: normalizeProductKeySpecs(product.product_key_specs),
  };
}

function parseSemanticProductPrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.replace(/,/g, '').trim();
  if (!normalizedValue) {
    return null;
  }

  const parsed = Number(normalizedValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function getCategorySlug(
  categories:
    | { slug?: string | null }
    | Array<{ slug?: string | null }>
    | null
    | undefined
): string | null {
  const category = Array.isArray(categories) ? categories[0] : categories;
  return category?.slug?.trim() || null;
}

function getJoinedCategorySlug(
  product: ProductSeoRow,
  preferredCategorySlug: string
): string | null {
  const preferredJoinedSlug =
    product.product_categories
      ?.map((join) => getCategorySlug(join.categories))
      .find((slug): slug is string => slug === preferredCategorySlug) ?? null;
  if (preferredJoinedSlug) {
    return preferredJoinedSlug;
  }

  const directSlug = getCategorySlug(product.categories);
  if (directSlug) {
    return directSlug;
  }

  return (
    product.product_categories
      ?.map((join) => getCategorySlug(join.categories))
      .find((slug): slug is string => Boolean(slug)) ?? null
  );
}

export function mergeProductCandidates(
  products: ProductSemanticCandidate[]
): ProductSemanticCandidate[] {
  const seen = new Set<string>();
  return products.filter((product) => {
    if (!product.slug || seen.has(product.slug)) {
      return false;
    }
    seen.add(product.slug);
    return true;
  });
}

export function throwSeoInventoryError(
  message: string,
  details: Record<string, unknown>
): never {
  console.error('Failed to load product SEO link inventory', {
    ...details,
    reason: message,
  });
  throw new Error(
    `Product SEO link inventory unavailable (transient): ${message}`
  );
}
