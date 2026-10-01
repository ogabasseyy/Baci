import { OrderStatusUpdateError } from './orders/order-status-update-error';

type OrderDetailsGiglShipping = {
  refreshBalance: () => Promise<unknown>;
  requestQuote: () => Promise<unknown>;
};

export async function handleOrderDetailsProviderBookingError(
  error: unknown,
  giglShipping?: OrderDetailsGiglShipping | null
) {
  const code = error instanceof OrderStatusUpdateError ? error.code : undefined;
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
