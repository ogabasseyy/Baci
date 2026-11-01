import { canUseSelectedShippingProvider } from './order-shipment';

interface OrderGiglShippingVisibilityInput {
  /** Owner, or staff with orders.fulfill and orders.edit. */
  canBookGigl?: boolean;
  hasRecoverableWalletCharge?: boolean;
  order?: {
    selected_quote_id?: string | null;
    shipment_id?: string | null;
    shipping_funding_source?: 'customer_checkout' | 'merchant_wallet' | null;
    shipping_provider?: string | null;
    tracking_number?: string | null;
  } | null;
}

export function getOrderGiglShippingVisibility({
  canBookGigl = false,
  hasRecoverableWalletCharge = false,
  order,
}: OrderGiglShippingVisibilityInput) {
  const isSavedMerchantWalletGiglOrder = Boolean(
    order?.shipping_provider?.trim().toUpperCase() === 'GIGL' &&
      order.shipping_funding_source === 'merchant_wallet' &&
      order.selected_quote_id
  );
  // Keep merchant-wallet GIGL bookings on the bound quote so recovery can
  // reach the existing reservation instead of forcing a replacement quote.
  // Only the owner and staff with orders.fulfill and orders.edit can create
  // the first wallet debit, so anyone else is only offered booking when a
  // recoverable charge already exists.
  const canUseProvider = order ? canUseSelectedShippingProvider(order) : false;
  const providerBookingAvailable =
    isSavedMerchantWalletGiglOrder && !canBookGigl
      ? canUseProvider && hasRecoverableWalletCharge
      : canUseProvider;

  return {
    isSavedMerchantWalletGiglOrder,
    providerBookingAvailable,
  };
}
