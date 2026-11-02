import { canUseSelectedShippingProvider } from './order-shipment';

interface OrderGiglShippingVisibilityInput {
  /** Owner, or staff with orders.fulfill and orders.edit. */
  canBookGigl?: boolean;
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
  order,
}: OrderGiglShippingVisibilityInput) {
  const isGiglOrder = order?.shipping_provider?.trim().toUpperCase() === 'GIGL';
  const isSavedMerchantWalletGiglOrder = Boolean(
    isGiglOrder &&
      order?.shipping_funding_source === 'merchant_wallet' &&
      order.selected_quote_id
  );
  const canUseProvider = order ? canUseSelectedShippingProvider(order) : false;
  // Booking binds the saved quote (and debits the wallet for wallet orders), so
  // the server rejects it for anyone without GIG booking rights: owner, or
  // staff with orders.fulfill and orders.edit. Do not offer it to them.
  const needsBookingRights =
    isSavedMerchantWalletGiglOrder ||
    (isGiglOrder && order?.shipping_funding_source === 'customer_checkout');
  const providerBookingAvailable =
    needsBookingRights && !canBookGigl ? false : canUseProvider;

  return {
    // A saved quote exists whoever may book it; it, not booking rights,
    // decides whether the wallet quote flow applies.
    hasSavedProviderQuote: canUseProvider,
    isSavedMerchantWalletGiglOrder,
    providerBookingAvailable,
  };
}
