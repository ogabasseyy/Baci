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
 *
 * A partially paid invoice-method order has accepted money too
 * (`complete_merchant_invoice_partial_payment_v1` leaves the durable
 * `partially_paid` status): relabeling it proforma (325) would suppress
 * its Peppol artifact, so partial-payment evidence counts as previously
 * paid via `paymentStatus`.
 *
 * Wallet/savings credit applied at creation is persisted onto the row
 * (`recordPreGatewayRedemption` writes `amount_paid` while deliberately
 * leaving the status `unpaid`/`pending`): a positive credited balance is
 * the same accepted-value evidence, so `amountPaid` also counts as
 * previously paid.
 */
export function resolveInvoiceTypeCode(input: {
  paymentMethod?: unknown;
  isPaid: boolean;
  wasPaid?: boolean;
  paymentStatus?: unknown;
  amountPaid?: number | null;
  storedTypeCode?: unknown;
}): string {
  // Typeof-guarded trims: mobile detail fetches only warn on schema
  // failure, so corrupt numeric markers reach here at runtime and must
  // fail closed to undefined instead of throwing on .trim().
  const cleanText = (value: unknown) =>
    typeof value === 'string' ? value.trim() : undefined;
  const method = cleanText(input.paymentMethod)?.toLowerCase();
  const stored = cleanText(input.storedTypeCode);
  const status = cleanText(input.paymentStatus)?.toLowerCase();
  const creditedAmount = Number(input.amountPaid ?? 0);
  const previouslyPaid =
    input.wasPaid ||
    status === 'partially_paid' ||
    (Number.isFinite(creditedAmount) && creditedAmount > 0);
  if (method === 'invoice' && !input.isPaid && !previouslyPaid) {
    return stored && stored !== '380' ? stored : '325';
  }
  return stored || '380';
}
