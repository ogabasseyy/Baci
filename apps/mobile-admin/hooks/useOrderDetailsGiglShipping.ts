import type { Order } from '@baci/shared';
import { useOrderGiglPreviewPrefetch } from '@/hooks/orders/useOrderGiglPreviewPrefetch';
import { useOrderGiglShipping } from '@/hooks/orders/useOrderGiglShipping';
import type { Merchant } from '@/hooks/useMerchant';
import { getOrderGiglShippingVisibility } from '@/lib/order-gigl-shipping-visibility';
import {
  getOrderGiglInitialAddress,
  type ShipmentCompletionMode,
} from '@/lib/order-shipment';

interface UseOrderDetailsGiglShippingParams {
  giglEligible: boolean;
  merchant: Merchant | null;
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
  merchant,
  order,
  pendingShipmentMode,
  providerLabel,
  shipmentFlowStep,
  showShipmentFlow,
  showStatusModal = false,
  userId,
}: UseOrderDetailsGiglShippingParams) {
  const {
    isMerchantOwner,
    isSavedMerchantWalletGiglOrder,
    providerBookingAvailable,
  } = getOrderGiglShippingVisibility({
    merchantOwnerId: merchant?.user_id,
    order,
    userId,
  });
  const walletFlowApplicable =
    isMerchantOwner &&
    giglEligible &&
    (!providerBookingAvailable || isSavedMerchantWalletGiglOrder);
  // Price GIG once the owner heads for Ship Order (status sheet or the sheet's
  // details step) so the Shipping step shows it at once. Merely viewing an
  // order never asks: every /api/orders request shares one small rate limit.
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
    preview: pendingShipmentMode !== 'provider',
    previewCacheScope,
    storedOrder: order,
  });
  // Saved non-wallet provider quotes must hide the wallet panel entirely so
  // Book uses canUseProvider instead of a disabled wallet hook state.
  const giglShipping = walletFlowApplicable ? giglShippingState : undefined;

  return {
    effectiveProviderLabel:
      providerLabel || (giglShipping?.quote ? 'GIG Logistics' : null),
    giglShipping,
    isMerchantOwner,
    providerBookingAvailable,
  };
}
