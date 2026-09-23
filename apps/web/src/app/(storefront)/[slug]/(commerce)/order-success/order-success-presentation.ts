import type { StorefrontOrderData as OrderData } from './fetch-storefront-order';

/**
 * Invoice-method detection stays true after payment so a paid invoice
 * order keeps its commercial (380) document action; proforma
 * presentation is unpaid-only, matching resolveInvoiceTypeCode. A
 * refunded or partially paid invoice accepted money, so it keeps the
 * commercial presentation too — never "Proforma Invoice Ready". The
 * same prior-payment evidence as the invoice-type resolver: wallet,
 * savings, or partial-payment credit recorded in a positive
 * amount_paid while the status stays unpaid/pending is accepted value,
 * so the document is commercial even before the status flips.
 */
export function resolveInvoicePresentation({
  order,
  type,
}: {
  order: OrderData | null;
  type: string | null;
}): { isInvoice: boolean; isInvoiceMethod: boolean } {
  // The `type` query value is caller-controlled: once the order loads, the
  // stored payment method rules — otherwise `?type=invoice` dresses any
  // pending order (Paystack, bank transfer, …) in proforma copy and
  // invoice downloads. The hint only applies pre-load (order null).
  const isInvoiceMethod = order
    ? order.payment_status === 'invoice' || order.payment_method === 'invoice'
    : type === 'invoice';
  const creditedAmount = Number(order?.amount_paid ?? 0);
  const hasPriorPayment = Number.isFinite(creditedAmount) && creditedAmount > 0;
  const isInvoice =
    isInvoiceMethod &&
    order?.payment_status !== 'paid' &&
    order?.payment_status !== 'refunded' &&
    order?.payment_status !== 'partially_paid' &&
    !hasPriorPayment;
  return { isInvoice, isInvoiceMethod };
}

/**
 * Paid invoice-method document: the receipts archive computes
 * current_document_kind as receipt once a paid order has shipped or
 * been delivered, so this CTA must promise and link exactly the
 * document the archive offers — a receipt download for shipped /
 * delivered orders, the commercial invoice otherwise. Unpaid orders
 * are proforma and never reach this resolver's consumers.
 */
export function resolvePaidInvoiceDocument({
  order,
}: {
  order: OrderData | null;
}): { kind: 'invoice' | 'receipt'; label: string } {
  // Same eligibility as getCurrentDocumentKind
  // (storefront-account-document-data, the receipts archive authority):
  // every paid imported historical order is receipt-eligible regardless
  // of shipping status; other paid orders need shipped/delivered.
  const isPaid = order?.payment_status?.trim().toLowerCase() === 'paid';
  const isImportedHistoricalOrder = Boolean(
    order?.external_source || order?.import_job_id
  );
  const shippedOrDelivered = ['shipped', 'delivered'].includes(
    order?.shipping_status?.trim().toLowerCase() ?? ''
  );
  if (isPaid && (isImportedHistoricalOrder || shippedOrDelivered)) {
    return { kind: 'receipt', label: 'Download Receipt PDF' };
  }
  return { kind: 'invoice', label: 'Download Commercial Invoice PDF' };
}

export function buildOrderSuccessCopy({
  hasRecoveryState,
  hasValidatedOrder,
  isInvoice,
  isPayForMeUnpaid,
  payerName,
}: {
  hasRecoveryState: boolean;
  hasValidatedOrder: boolean;
  isInvoice: boolean;
  isPayForMeUnpaid: boolean;
  payerName: string;
}): { description: string; heading: string } {
  const heading = hasValidatedOrder
    ? isPayForMeUnpaid
      ? 'Share the Payment Details'
      : isInvoice
        ? 'Proforma Invoice Ready!'
        : 'Order Confirmed!'
    : hasRecoveryState
      ? 'We could not confirm this order yet'
      : 'Finalizing your order';
  const description = hasValidatedOrder
    ? isPayForMeUnpaid
      ? `Send the payment details below to ${payerName} — your order will be processed once payment is received.`
      : isInvoice
        ? 'We have prepared your proforma invoice and sent it to your email. Share it with your company or procurement team.'
        : 'Thank you for your purchase. Your order has been received.'
    : hasRecoveryState
      ? 'We could not validate this order from the current link. You can return to checkout or keep shopping while we sort it out.'
      : 'We are validating your order details now. This page will update as soon as your confirmation is ready.';
  return { description, heading };
}

export function buildGoogleReviewProducts(
  order: OrderData | null
): Array<{ gtin: string }> {
  return (
    order?.items
      .map((item) => item.gtin?.trim())
      .filter((gtin): gtin is string => Boolean(gtin))
      .map((gtin) => ({ gtin })) ?? []
  );
}
