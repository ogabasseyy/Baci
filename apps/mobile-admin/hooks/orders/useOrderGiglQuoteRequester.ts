import { useQueryClient } from '@tanstack/react-query';
import { type RefObject, useRef } from 'react';
import type { OrderGiglStoredAddressSource } from '@/lib/order-gigl-address-save-plan';
import {
  readCachedOrderGiglPreview,
  requestOrderGiglQuote,
} from '@/lib/order-gigl-quote-request';
import type { OrderGiglReceiver } from '@/lib/order-gigl-shipping';
import { getOrderGiglAddressSignature } from '@/lib/order-gigl-shipping-state';
import { getOrderGiglInitialAddress } from '@/lib/order-shipment';

interface SavedAddress {
  basis: string;
  shippingAddress: Record<string, unknown>;
}

interface UseOrderGiglQuoteRequesterParams {
  /** The GIG panel's current receiver draft. */
  addressRef: RefObject<Partial<OrderGiglReceiver>>;
  previewCacheScope?: string;
  storedOrder?: OrderGiglStoredAddressSource;
}

type InitialAddressOrder = Parameters<typeof getOrderGiglInitialAddress>[0];

function addressBasis(order?: OrderGiglStoredAddressSource) {
  // The bound quote is scoped to these semantic destination fields. Using
  // their signature also ignores JSONB key-order changes during a refetch.
  return addressSignature(order);
}

function addressSignature(order?: OrderGiglStoredAddressSource) {
  return getOrderGiglAddressSignature(
    getOrderGiglInitialAddress({
      customer_phone: order?.customer_phone,
      // Stored JSON, read the same way the panel reads the order.
      shipping_address:
        order?.shipping_address as InitialAddressOrder['shipping_address'],
    })
  );
}

/**
 * Sends GIG panel quote requests: previews share the background prefetch, and
 * bound quotes first save typed address details to the order. After a save the
 * cached order stays stale until it is refetched, so the saved address stands
 * in until then: a retry neither saves again (an order edit clears a freshly
 * bound quote) nor sends a receiver override the bind would refuse.
 */
export function useOrderGiglQuoteRequester({
  addressRef,
  previewCacheScope,
  storedOrder,
}: UseOrderGiglQuoteRequesterParams) {
  const queryClient = useQueryClient();
  const storedRef = useRef(storedOrder);
  const savedRef = useRef<SavedAddress | null>(null);
  storedRef.current = storedOrder;

  const currentStoredOrder = () => {
    const stored = storedRef.current;
    const saved = savedRef.current;
    if (!stored || !saved || saved.basis !== addressBasis(stored)) {
      return stored;
    }
    return { ...stored, shipping_address: saved.shippingAddress };
  };

  const fetchQuote = async (
    orderId: string,
    preview: boolean,
    signal: AbortSignal,
    saveAddress = true
  ) => {
    const order = currentStoredOrder();
    const startingAddressBasis = addressBasis(order);
    let signature = preview ? null : addressSignature(order);
    let addressSaved = false;
    try {
      const result = await requestOrderGiglQuote({
        cacheScope: previewCacheScope,
        draft: preview || saveAddress ? addressRef.current : {},
        onAddressSaved: (shippingAddress) => {
          addressSaved = true;
          if (signal.aborted) return;
          const savedAddressOrder = {
            ...order,
            shipping_address: shippingAddress,
          };
          const savedAddressSignature = addressSignature(savedAddressOrder);
          const currentBasis = addressBasis(storedRef.current);
          if (
            currentBasis !== startingAddressBasis &&
            currentBasis !== savedAddressSignature
          ) {
            throw Object.assign(
              new Error('Delivery address changed while saving.'),
              { code: 'stale_order_quote_inputs' }
            );
          }
          signature = savedAddressSignature;
          savedRef.current = {
            // The overlay only replaces the address version this save began
            // from. A newer refetch must remain authoritative.
            basis: startingAddressBasis,
            shippingAddress,
          };
        },
        orderId,
        preview,
        queryClient,
        signal,
        storedOrder: order,
      });
      if (
        !signal.aborted &&
        signature !== null &&
        signature !== addressSignature(currentStoredOrder())
      ) {
        throw Object.assign(
          new Error('Delivery address changed while pricing.'),
          {
            code: 'stale_order_quote_inputs',
          }
        );
      }
      return { result, signature };
    } finally {
      // Refresh the order only after the bind settles, so the refetch cannot
      // restart the quote request while it is still in flight.
      if (addressSaved) {
        void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      }
    }
  };

  return {
    clear: () => {
      savedRef.current = null;
    },
    storedAddressSignature: () => addressSignature(currentStoredOrder()),
    readCachedPreview: (orderId: string) =>
      readCachedOrderGiglPreview({
        cacheScope: previewCacheScope,
        draft: addressRef.current,
        orderId,
        queryClient,
      }),
    fetch: fetchQuote,
  };
}
