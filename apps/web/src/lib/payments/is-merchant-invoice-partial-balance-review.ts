const MERCHANT_INVOICE_PARTIAL_BALANCE_CHANGED =
  'MERCHANT_INVOICE_PARTIAL_BALANCE_CHANGED';

export function isMerchantInvoicePartialBalanceReview(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  return (
    'error_code' in error &&
    error.error_code === MERCHANT_INVOICE_PARTIAL_BALANCE_CHANGED
  );
}
