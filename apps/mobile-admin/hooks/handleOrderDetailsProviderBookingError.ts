import { OrderStatusUpdateError } from './orders/order-status-update-error';

export type ProviderBookingErrorOutcome = 'review_checkout_quote' | undefined;

type OrderDetailsGiglShipping = {
  refreshBalance: () => Promise<unknown>;
  requestQuote: () => Promise<unknown>;
};

export async function handleOrderDetailsProviderBookingError(
  error: unknown,
  giglShipping?: OrderDetailsGiglShipping | null,
  checkoutRecoveryEligible = false
): Promise<ProviderBookingErrorOutcome> {
  const code = error instanceof OrderStatusUpdateError ? error.code : undefined;
  if (
    code === 'SHIPPING_QUOTE_RECONFIRM_REQUIRED' &&
    checkoutRecoveryEligible
  ) {
    return 'review_checkout_quote';
  }
  if (code === 'MERCHANT_WALLET_INSUFFICIENT') {
    try {
      await giglShipping?.refreshBalance();
    } catch {
      // Keep the original insufficient-balance error visible to the merchant.
    }
  }
  if (code === 'MERCHANT_WALLET_QUOTE_RECONFIRM_REQUIRED') {
    try {
      await giglShipping?.requestQuote();
    } catch {
      // Keep the original reconfirm error visible to the merchant.
    }
  }
}
