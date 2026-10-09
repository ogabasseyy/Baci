import type { QueryClient } from '@tanstack/react-query';
import type { Product } from '@/types/product';

interface CachedProductStock {
  id: string;
  stock_quantity?: number;
}

function findCachedProduct(
  queryClient: QueryClient,
  productId: string
): Product | undefined {
  const queries = queryClient.getQueriesData<unknown[]>({
    queryKey: ['products'],
  });

  for (const [, data] of queries) {
    if (!Array.isArray(data)) continue;
    const product = data.find(
      (item): item is Product =>
        typeof item === 'object' &&
        item !== null &&
        (item as Product).id != null &&
        String((item as Product).id) === productId
    );
    if (product) return product;
  }

  return undefined;
}

export function getCachedProductStock(
  queryClient: QueryClient,
  productId: string
): number | undefined {
  const queries = queryClient.getQueriesData<CachedProductStock[]>({
    queryKey: ['products'],
  });

  for (const [, data] of queries) {
    if (!Array.isArray(data)) continue;
    const product = data.find(
      (item): item is CachedProductStock =>
        item?.id === productId && item.stock_quantity != null
    );
    if (product) return product.stock_quantity;
  }

  return undefined;
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
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

  const product = findCachedProduct(queryClient, productId);
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
