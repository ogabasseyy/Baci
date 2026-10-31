import type { Order } from '@baci/shared';
import { useOrderGiglPreviewPrefetch } from '@/hooks/orders/useOrderGiglPreviewPrefetch';
import { useOrderGiglShipping } from '@/hooks/orders/useOrderGiglShipping';
import { useOrderFulfillAccess } from '@/hooks/useOrderFulfillAccess';
import { getOrderGiglShippingVisibility } from '@/lib/order-gigl-shipping-visibility';
import {
  getOrderGiglInitialAddress,
  type ShipmentCompletionMode,
} from '@/lib/order-shipment';
import { canBookOrderGigl } from '@/schemas/order-fulfill-access';

interface UseOrderDetailsGiglShippingParams {
  giglEligible: boolean;
  order: Order | undefined;
  pendingShipmentMode: ShipmentCompletionMode;
  providerLabel: string | null;
  shipmentFlowStep: string;
  showShipmentFlow: boolean;
  /** The status sheet is the way into Ship Order, so it starts the prefetch. */
  showStatusModal?: boolean;
  userId?: string | null;
}

export function useOrderDetailsGiglShipping({
  giglEligible,
  order,
  pendingShipmentMode,
  providerLabel,
  shipmentFlowStep,
  showShipmentFlow,
  showStatusModal = false,
  userId,
}: UseOrderDetailsGiglShippingParams) {
  // Owner, or staff with orders.fulfill, may see the GIG price; binding and
  // booking it also need orders.edit (see canBookOrderGigl).
  const fulfillAccess = useOrderFulfillAccess();
  const canBookGigl = canBookOrderGigl(fulfillAccess);
  const { isSavedMerchantWalletGiglOrder, providerBookingAvailable } =
    getOrderGiglShippingVisibility({ canBookGigl, order });
  const walletFlowApplicable =
    fulfillAccess.canFulfill &&
    giglEligible &&
    (!providerBookingAvailable || isSavedMerchantWalletGiglOrder);
  // Price GIG once the merchant heads for Ship Order (status sheet or the
  // sheet's details step) so the Shipping step shows it at once. Merely viewing
  // an order never asks: every /api/orders request shares one small rate limit.
  const previewCacheScope = useOrderGiglPreviewPrefetch({
    enabled: walletFlowApplicable && (showStatusModal || showShipmentFlow),
    order,
    userId,
  });
  const giglShippingState = useOrderGiglShipping({
    enabled:
      walletFlowApplicable && showShipmentFlow && shipmentFlowStep === 'method',
    initialAddress: order ? getOrderGiglInitialAddress(order) : undefined,
    orderId: order?.id ?? '',
    // Without booking rights only the side-effect-free preview is requested,
    // so the quote is never bound and the wallet is never funded.
    preview: pendingShipmentMode !== 'provider' || !canBookGigl,
    previewCacheScope,
    storedOrder: order,
  });
  // Saved non-wallet provider quotes must hide the wallet panel entirely so
  // Book uses canUseProvider instead of a disabled wallet hook state.
  const giglShipping = walletFlowApplicable ? giglShippingState : undefined;

  return {
    canBookGigl,
    effectiveProviderLabel:
      providerLabel || (giglShipping?.quote ? 'GIG Logistics' : null),
    giglShipping,
    providerBookingAvailable,
  };
}
