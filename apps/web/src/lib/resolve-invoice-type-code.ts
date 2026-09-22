/**
 * Resolves the Peppol invoice type code for a storefront order document.
 *
 * Unpaid invoice-payment orders are proforma (325) documents. The orders
 * table defaults `invoice_type_code` to 380, so a stored 380 on an unpaid
 * invoice-method order is the meaningless default and must not win over the
 * proforma classification; an explicit non-default code is preserved.
 *
 * A refunded invoice-method order is not a quotation: it represents a
 * completed transaction whose payment was later returned, so `wasPaid`
 * keeps the commercial (380) classification even though the order is not
 * currently paid.
 */
export function resolveInvoiceTypeCode(input: {
  paymentMethod?: string | null;
  isPaid: boolean;
  wasPaid?: boolean;
  storedTypeCode?: string | null;
}): string {
  const method = input.paymentMethod?.trim().toLowerCase();
  const stored = input.storedTypeCode?.trim();
  if (method === 'invoice' && !input.isPaid && !input.wasPaid) {
    return stored && stored !== '380' ? stored : '325';
  }
  return stored || '380';
}
