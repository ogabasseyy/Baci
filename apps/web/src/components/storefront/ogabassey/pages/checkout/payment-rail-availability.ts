import { isBankTransferCheckoutAvailable, isKorapayCheckoutAvailable, isPaystackCheckoutAvailable } from '@/lib/checkout/payment-gateway-availability';
import { isNgnChargeCurrency } from './components/payment-step-availability';

export function checkoutPaymentRails(merchant: Parameters<typeof isPaystackCheckoutAvailable>[0], currencyCode: string) {
  const ngn = isNgnChargeCurrency(currencyCode);
  return {
    paystackCheckoutAvailable: ngn && isPaystackCheckoutAvailable(merchant),
    korapayCheckoutAvailable: isKorapayCheckoutAvailable(merchant, currencyCode),
    bankTransferCheckoutAvailable: ngn && isBankTransferCheckoutAvailable(merchant),
  };
}
