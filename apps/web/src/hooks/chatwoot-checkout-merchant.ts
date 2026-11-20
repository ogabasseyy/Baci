import type { MerchantData } from '@/hooks/merchant/types';

/**
 * Merchant id and fractional VAT rate for the in-chat checkout, read the way
 * the store checkout reads them: `registered` merchants charge their rate
 * (7.5% by default), everyone else charges none.
 */
export function toChatwootCheckoutMerchant(
  merchant: Pick<
    MerchantData,
    'id' | 'vat_registration_status' | 'vat_rate'
  > | null
): { id: string; taxRate: number } | null {
  if (!merchant?.id) return null;
  return {
    id: merchant.id,
    taxRate:
      merchant.vat_registration_status === 'registered'
        ? (merchant.vat_rate ?? 7.5) / 100
        : 0,
  };
}
