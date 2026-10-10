import type { QueryClient } from '@tanstack/react-query';
import type { Product } from '@/types/product';

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function isProductLike(value: unknown): value is Product {
  return (
    typeof value === 'object' && value !== null && (value as Product).id != null
  );
}

function findProductInList(
  value: unknown,
  productId: string
): Product | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.find(
    (item): item is Product =>
      isProductLike(item) && String(item.id) === productId
  );
}

function collectListCachedProducts(
  queryClient: QueryClient,
  productId: string
): Product[] {
  // List queries are infinite: ['products', merchantId, options] holds
  // { pages: [{ products }] }, not a top-level array.
  const matches: Product[] = [];
  const listQueries = queryClient.getQueriesData<unknown>({
    queryKey: ['products'],
  });
  for (const [, data] of listQueries) {
    const pages =
      typeof data === 'object' && data !== null
        ? (data as { pages?: unknown }).pages
        : undefined;
    if (Array.isArray(pages)) {
      for (const page of pages) {
        const found = findProductInList(
          (page as { products?: unknown } | null)?.products,
          productId
        );
        if (found) matches.push(found);
      }
    }
    // Flat arrays: the launch-carousel pins writer
    // (['products', merchantId, 'launch-by-slugs', slugs]).
    const flat = findProductInList(data, productId);
    if (flat) matches.push(flat);
  }
  return matches;
}

function findDetailCachedProduct(
  queryClient: QueryClient,
  productId: string,
  options?: { variantId?: string | null; offerId?: string | null }
): Product | undefined {
  // Detail queries hold one augmented product:
  // ['product', version, slug, merchantId].
  const detailQueries = queryClient.getQueriesData<unknown>({
    queryKey: ['product'],
  });
  for (const [, data] of detailQueries) {
    if (!isProductLike(data) || String(data.id) !== productId) continue;
    if (!options || productHasOption(data, options)) return data;
  }
  return undefined;
}

function productHasOption(
  product: Product,
  options: { variantId?: string | null; offerId?: string | null }
): boolean {
  if (options.variantId != null) {
    return (
      product.variants?.some((entry) => entry.id === options.variantId) ?? false
    );
  }
  if (options.offerId != null) {
    return (
      product.offers?.some(
        (entry) => String(entry.id) === String(options.offerId)
      ) ?? false
    );
  }
  return true;
}

function findCachedProduct(
  queryClient: QueryClient,
  productId: string
): Product | undefined {
  return (
    collectListCachedProducts(queryClient, productId)[0] ??
    findDetailCachedProduct(queryClient, productId)
  );
}

/**
 * Option-aware lookup: list rows use PRODUCT_SELECT and generally carry
 * no hydrated offers/variants, so the first list match cannot resolve an
 * option the shopper opened from the list and then viewed (which
 * populates the detail cache). Prefer the augmented detail entry when it
 * holds the requested option, else keep scanning list entries past the
 * first match. Returns undefined when no cached entry holds the option
 * so callers fail closed.
 */
function findCachedProductWithOption(
  queryClient: QueryClient,
  productId: string,
  options: { variantId?: string | null; offerId?: string | null }
): Product | undefined {
  return (
    findDetailCachedProduct(queryClient, productId, options) ??
    collectListCachedProducts(queryClient, productId).find((entry) =>
      productHasOption(entry, options)
    )
  );
}

export function getCachedProductStock(
  queryClient: QueryClient,
  productId: string
): number | undefined {
  const product = findCachedProduct(queryClient, productId);
  return finiteOrUndefined(product?.stock_quantity);
}

/**
 * Cached availability for an exact cart option, mirroring the live
 * checkStock precedence (variant wins over offer) and the serialized
 * minimums. Returns undefined when the option is absent from the cache
 * so offline/error-path checks fail closed instead of comparing an
 * option line against the parent total.
 */
export function getCachedOptionStock(
  queryClient: QueryClient,
  productId: string,
  options?: { variantId?: string | null; offerId?: string | null }
): number | undefined {
  const variantId = options?.variantId ?? null;
  const offerId = variantId === null ? (options?.offerId ?? null) : null;
  if (variantId === null && offerId === null) {
    return getCachedProductStock(queryClient, productId);
  }

  const product = findCachedProductWithOption(queryClient, productId, {
    variantId,
    offerId,
  });
  if (!product) return undefined;

  if (variantId !== null) {
    const variant = product.variants?.find((entry) => entry.id === variantId);
    if (!variant) return undefined;
    if (variant.effective_policy === 'serialized_then_unlimited') {
      return Number.MAX_SAFE_INTEGER;
    }
    if (variant.effective_policy === 'serialized_strict') {
      const units = finiteOrUndefined(variant.available_units);
      return units === undefined ? undefined : Math.max(0, units);
    }
    return (
      finiteOrUndefined(variant.stock_quantity) ??
      getCachedProductStock(queryClient, productId)
    );
  }

  const offer = product.offers?.find(
    (entry) => String(entry.id) === String(offerId)
  );
  if (!offer) return undefined;
  const scalar = finiteOrUndefined(offer.stock_quantity);
  if (product.base_effective_policy === 'serialized_strict') {
    const units = finiteOrUndefined(product.base_available_units);
    if (units === undefined) return undefined;
    const capped = Math.max(0, units);
    return Math.min(scalar ?? capped, capped);
  }
  if (product.base_effective_policy === 'serialized_then_unlimited') {
    return scalar ?? Number.MAX_SAFE_INTEGER;
  }
  return scalar ?? getCachedProductStock(queryClient, productId);
}
