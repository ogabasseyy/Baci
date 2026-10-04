/**
 * Merchant bank details are untyped NGN accounts: they may back a
 * naira-denominated document, but printing them beside a foreign-currency
 * amount risks a rejected or mis-converted transfer. Builders strip the
 * bank fields for non-NGN documents so the renderers' merchant-bank
 * fallback has nothing to print.
 */
export function showMerchantBankDetails(
  orderCurrency: string | null | undefined
): boolean {
  return (orderCurrency || 'NGN').trim().toUpperCase() === 'NGN';
}
