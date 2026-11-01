import { useQuery } from '@tanstack/react-query';
import {
  getOrderGiglPreviewCacheScope,
  type OrderGiglPreviewItem,
  orderGiglPreviewQueryOptions,
} from '@/lib/order-gigl-preview-cache';
import {
  type OrderGiglPreviewTargetOrder,
  resolveOrderGiglPreviewTarget,
} from '@/lib/order-gigl-preview-target';

interface UseOrderGiglPreviewPrefetchParams {
  /** True only when the owner's GIG wallet panel would apply to this order. */
  enabled: boolean;
  order:
    | (OrderGiglPreviewTargetOrder & {
        items?: readonly OrderGiglPreviewItem[] | null;
      })
    | null
    | undefined;
  userId?: string | null;
}

/**
 * Prices GIG in the background while the merchant reviews an order, so the
 * Ship Order sheet can show "Ship with GIG" with a price as soon as it reaches
 * the Shipping step. The request is the side-effect-free preview, made once
 * per order, address and items, and cached until shortly before it expires.
 * Returns the cache scope the sheet passes to useOrderGiglShipping.
 */
export function useOrderGiglPreviewPrefetch({
  enabled,
  order,
  userId,
}: UseOrderGiglPreviewPrefetchParams) {
  const cacheScope = getOrderGiglPreviewCacheScope({
    items: order?.items,
    userId,
  });
  const target = enabled ? resolveOrderGiglPreviewTarget(order) : null;
  useQuery(orderGiglPreviewQueryOptions(target && { cacheScope, ...target }));
  return cacheScope;
}
