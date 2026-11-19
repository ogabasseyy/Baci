import {
  type QueryClient,
  queryOptions,
  skipToken,
} from '@tanstack/react-query';
import {
  getOrderGiglQuote,
  type OrderGiglQuoteResult,
  type OrderGiglReceiver,
} from './order-gigl-shipping';
import {
  GIGL_CONFIRMATION_SAFETY_MS,
  isOrderGiglQuoteFresh,
} from './order-gigl-shipping-state';

const ORDER_GIGL_PREVIEW_QUERY_ROOT = 'order-gigl-preview';
// GIG quotes expire after an hour, so an unused preview is never worth keeping
// longer than that.
const ORDER_GIGL_PREVIEW_GC_MS = 60 * 60 * 1000;

export interface OrderGiglPreviewRequest {
  cacheScope: string;
  orderId: string;
  receiver: OrderGiglReceiver;
}

export interface OrderGiglPreviewItem {
  id?: string | null;
  name?: string | null;
  price?: number | null;
  product_id?: string | null;
  quantity?: number | null;
  variant_id?: string | null;
}

/**
 * Scopes cached previews to the viewer and the order's items, so an item edit
 * or a different signed-in owner never reuses another price.
 */
export function getOrderGiglPreviewCacheScope({
  items,
  userId,
}: {
  items?: readonly OrderGiglPreviewItem[] | null;
  userId?: string | null;
}) {
  const itemKeys = (items ?? [])
    .map((item) =>
      JSON.stringify([
        item.id ?? null,
        item.product_id ?? null,
        item.variant_id ?? null,
        item.name ?? null,
        item.quantity ?? null,
        item.price ?? null,
      ])
    )
    .sort();
  return JSON.stringify([userId ?? null, itemKeys]);
}

export function getOrderGiglPreviewQueryKey({
  cacheScope,
  orderId,
  receiver,
}: OrderGiglPreviewRequest): readonly string[] {
  return [
    ORDER_GIGL_PREVIEW_QUERY_ROOT,
    orderId,
    cacheScope,
    JSON.stringify([
      receiver.address,
      receiver.city ?? null,
      receiver.state ?? null,
      receiver.phone,
      receiver.latitude ?? null,
      receiver.longitude ?? null,
    ]),
  ];
}

/** Keeps a preview fresh until the confirmation safety window before expiry. */
export function getOrderGiglPreviewStaleTime(
  data: OrderGiglQuoteResult | undefined,
  dataUpdatedAt: number
) {
  if (!data) return 0;
  const expiry = new Date(data.quote.expiresAt).getTime();
  if (!Number.isFinite(expiry)) return 0;
  return Math.max(0, expiry - GIGL_CONFIRMATION_SAFETY_MS - dataUpdatedAt);
}

export function orderGiglPreviewQueryOptions(
  request: OrderGiglPreviewRequest | null
) {
  return queryOptions({
    gcTime: ORDER_GIGL_PREVIEW_GC_MS,
    queryKey: request
      ? getOrderGiglPreviewQueryKey(request)
      : [ORDER_GIGL_PREVIEW_QUERY_ROOT, 'disabled'],
    // The preview is side-effect free, so it is not tied to an abort signal:
    // letting it finish keeps the price cached for the Ship Order sheet.
    queryFn: request
      ? () =>
          getOrderGiglQuote(request.orderId, request.receiver, undefined, true)
      : skipToken,
    // Failures stay silent here; the GIG panel retries and shows its own
    // error UI once the merchant reaches the Shipping step.
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: (query) =>
      getOrderGiglPreviewStaleTime(query.state.data, query.state.dataUpdatedAt),
  });
}

export function readFreshOrderGiglPreview(
  queryClient: QueryClient,
  request: OrderGiglPreviewRequest,
  now = Date.now()
): OrderGiglQuoteResult | null {
  const data = queryClient.getQueryData<OrderGiglQuoteResult>(
    getOrderGiglPreviewQueryKey(request)
  );
  return data && isOrderGiglQuoteFresh(data.quote, now) ? data : null;
}

/** Reuses a fresh or in-flight preview instead of asking GIG again. */
export function fetchOrderGiglPreview(
  queryClient: QueryClient,
  request: OrderGiglPreviewRequest
) {
  return queryClient.fetchQuery(orderGiglPreviewQueryOptions(request));
}
