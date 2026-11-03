import type { QueryClient } from '@tanstack/react-query';
import {
  type OrderGiglStoredAddressSource,
  planOrderGiglAddressSave,
} from './order-gigl-address-save-plan';
import {
  fetchOrderGiglPreview,
  readFreshOrderGiglPreview,
} from './order-gigl-preview-cache';
import {
  getOrderGiglQuote,
  type OrderGiglReceiver,
  saveOrderGiglShippingAddress,
} from './order-gigl-shipping';
import { toCompleteOrderGiglReceiver } from './order-gigl-shipping-state';

interface CachedOrderGiglPreviewInput {
  cacheScope?: string;
  draft: Partial<OrderGiglReceiver>;
  orderId: string;
  queryClient: QueryClient;
}

interface RequestOrderGiglQuoteInput extends CachedOrderGiglPreviewInput {
  onAddressSaved?: (shippingAddress: Record<string, unknown>) => void;
  preview: boolean;
  signal: AbortSignal;
  storedOrder?: OrderGiglStoredAddressSource;
}

/** A still-fresh background preview for the panel's current receiver. */
export function readCachedOrderGiglPreview({
  cacheScope,
  draft,
  orderId,
  queryClient,
}: CachedOrderGiglPreviewInput) {
  const receiver = toCompleteOrderGiglReceiver(draft);
  if (!receiver || cacheScope === undefined || !orderId) return null;
  return readFreshOrderGiglPreview(queryClient, {
    cacheScope,
    orderId,
    receiver,
  });
}

export async function requestOrderGiglQuote({
  cacheScope,
  draft,
  onAddressSaved,
  orderId,
  preview,
  queryClient,
  signal,
  storedOrder,
}: RequestOrderGiglQuoteInput) {
  const receiver = toCompleteOrderGiglReceiver(draft);
  if (preview) {
    // Previews never write. They share the background prefetch (including an
    // in-flight one) when the receiver matches it.
    return receiver && cacheScope !== undefined
      ? fetchOrderGiglPreview(queryClient, { cacheScope, orderId, receiver })
      : getOrderGiglQuote(orderId, receiver, signal, true);
  }
  if (!storedOrder) return getOrderGiglQuote(orderId, receiver, signal);
  const plan = receiver
    ? planOrderGiglAddressSave(storedOrder, receiver)
    : ({ kind: 'unchanged' } as const);
  if (plan.kind === 'locked') {
    return getOrderGiglQuote(orderId, receiver, signal);
  }
  if (plan.kind === 'save') {
    await saveOrderGiglShippingAddress(orderId, plan.shippingAddress, signal);
    onAddressSaved?.(plan.shippingAddress);
  }
  // The bind compares its receiver with the stored order address, so the
  // bound quote is priced from the stored (now complete) address.
  return getOrderGiglQuote(orderId, undefined, signal);
}
