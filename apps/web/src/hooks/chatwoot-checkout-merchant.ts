import type { MerchantData } from '@/hooks/merchant/types';
import {
  type CheckoutPaymentMerchant,
  isBankTransferCheckoutAvailable,
} from '@/lib/checkout/payment-gateway-availability';

export interface ChatwootCheckoutMerchant {
  id: string;
  /** Fractional VAT rate; 0 when the merchant is not VAT registered. */
  taxRate: number;
  /** The store checkout's own gate for offering bank transfer. */
  bankTransferAvailable: boolean;
}

/**
 * Merchant facts for the in-chat checkout, read the way the store checkout
 * reads them from the same storefront merchant context: `registered`
 * merchants charge their rate (7.5% by default), and bank transfer is offered
 * only where `isBankTransferCheckoutAvailable` says so.
 */
export function toChatwootCheckoutMerchant(
  merchant:
    | (Pick<MerchantData, 'id' | 'vat_registration_status' | 'vat_rate'> &
        CheckoutPaymentMerchant)
    | null
): ChatwootCheckoutMerchant | null {
  if (!merchant?.id) return null;
  return {
    id: merchant.id,
    taxRate:
      merchant.vat_registration_status === 'registered'
        ? (merchant.vat_rate ?? 7.5) / 100
        : 0,
    bankTransferAvailable: isBankTransferCheckoutAvailable(merchant),
  };
}
