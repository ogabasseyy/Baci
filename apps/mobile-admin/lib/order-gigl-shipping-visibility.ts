import { isGiglShippingRetainingPaymentMethod } from '@baci/shared';
import { canUseSelectedShippingProvider } from './order-shipment';

interface OrderGiglShippingVisibilityInput {
  hasRecoverableWalletCharge?: boolean;
  merchantOwnerId?: string | null;
  order?: {
    payment_method?: string | null;
    payment_status?: string | null;
    selected_quote_id?: string | null;
    shipment_id?: string | null;
    shipping_funding_source?: 'customer_checkout' | 'merchant_wallet' | null;
    shipping_provider?: string | null;
    tracking_number?: string | null;
  } | null;
  userId?: string | null;
}

function isPayOnDelivery(paymentMethod: string | null | undefined) {
  const method = (paymentMethod ?? '').trim().toLowerCase();
  return method === 'pod' || method === 'pay_on_delivery';
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
  // Mirrors assertGiglCustomerCheckoutPrepaid: an unstamped (null funding) GIG
  // order books directly only when it is paid by a method that retained the
  // shipping fee. Credit Direct, bank transfer, POD and unpaid orders are
  // refused there (GIGL_REQUIRES_PREPAID_OR_WALLET), so they must go through
  // the wallet panel, which rebinds the order to the merchant (or Baci) wallet.
  const requiresWalletRebind = Boolean(
    order?.shipping_provider?.trim().toUpperCase() === 'GIGL' &&
      order.selected_quote_id &&
      order.shipping_funding_source == null &&
      (order.payment_status?.trim().toLowerCase() !== 'paid' ||
        isPayOnDelivery(order.payment_method) ||
        !isGiglShippingRetainingPaymentMethod(order.payment_method))
  );
  // Keep merchant-wallet GIGL bookings on the bound quote so recovery can
  // reach the existing reservation instead of forcing a replacement quote.
  // Staff cannot create the first wallet debit (owner-only), so only advertise
  // booking when a recoverable charge already exists.
  const canUseProvider = order ? canUseSelectedShippingProvider(order) : false;
  const providerBookingAvailable = requiresWalletRebind
    ? false
    : isSavedMerchantWalletGiglOrder && !isMerchantOwner
      ? canUseProvider && hasRecoverableWalletCharge
      : canUseProvider;

  return {
    isMerchantOwner,
    isSavedMerchantWalletGiglOrder,
    providerBookingAvailable,
    requiresWalletRebind,
  };
}
