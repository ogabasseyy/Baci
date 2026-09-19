/**
 * Resolves the Peppol invoice type code for a storefront order document.
 *
 * Unpaid invoice-payment orders are proforma (325) documents. The orders
 * table defaults `invoice_type_code` to 380, so a stored 380 on an unpaid
 * invoice-method order is the meaningless default and must not win over the
 * proforma classification; an explicit non-default code is preserved.
 */
export function resolveInvoiceTypeCode(input: {
  paymentMethod?: string | null;
  isPaid: boolean;
  storedTypeCode?: string | null;
}): string {
  const method = input.paymentMethod?.trim().toLowerCase();
  const stored = input.storedTypeCode?.trim();
  if (method === 'invoice' && !input.isPaid) {
    return stored && stored !== '380' ? stored : '325';
  }
  return stored || '380';
}
