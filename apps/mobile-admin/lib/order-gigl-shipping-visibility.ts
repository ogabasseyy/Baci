import { canUseSelectedShippingProvider } from './order-shipment';

interface OrderGiglShippingVisibilityInput {
  hasRecoverableWalletCharge?: boolean;
  merchantOwnerId?: string | null;
  order?: {
    selected_quote_id?: string | null;
    shipment_id?: string | null;
    shipping_funding_source?: 'customer_checkout' | 'merchant_wallet' | null;
    shipping_provider?: string | null;
    tracking_number?: string | null;
  } | null;
  userId?: string | null;
}

export function getOrderGiglShippingVisibility({
  hasRecoverableWalletCharge = false,
  merchantOwnerId,
  order,
  userId,
}: OrderGiglShippingVisibilityInput) {
  const isMerchantOwner = Boolean(
    userId && merchantOwnerId && userId === merchantOwnerId
  );
  const isSavedMerchantWalletGiglOrder = Boolean(
    order?.shipping_provider?.trim().toUpperCase() === 'GIGL' &&
      order.shipping_funding_source === 'merchant_wallet' &&
      order.selected_quote_id
  );
  // Keep merchant-wallet GIGL bookings on the bound quote so recovery can
  // reach the existing reservation instead of forcing a replacement quote.
  // Staff cannot create the first wallet debit (owner-only), so only advertise
  // booking when a recoverable charge already exists.
  const canUseProvider = order ? canUseSelectedShippingProvider(order) : false;
  const providerBookingAvailable =
    isSavedMerchantWalletGiglOrder && !isMerchantOwner
      ? canUseProvider && hasRecoverableWalletCharge
      : canUseProvider;

  return {
    isMerchantOwner,
    isSavedMerchantWalletGiglOrder,
    providerBookingAvailable,
  };
}
