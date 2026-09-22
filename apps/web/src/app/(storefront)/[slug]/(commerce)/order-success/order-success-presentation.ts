import type { StorefrontOrderData as OrderData } from './fetch-storefront-order';

/**
 * Invoice-method detection stays true after payment so a paid invoice
 * order keeps its commercial (380) document action; proforma
 * presentation is unpaid-only, matching resolveInvoiceTypeCode. A
 * refunded or partially paid invoice accepted money, so it keeps the
 * commercial presentation too — never "Proforma Invoice Ready".
 */
export function resolveInvoicePresentation({
  order,
  type,
}: {
  order: OrderData | null;
  type: string | null;
}): { isInvoice: boolean; isInvoiceMethod: boolean } {
  const isInvoiceMethod =
    type === 'invoice' ||
    order?.payment_status === 'invoice' ||
    order?.payment_method === 'invoice';
  const isInvoice =
    isInvoiceMethod &&
    order?.payment_status !== 'paid' &&
    order?.payment_status !== 'refunded' &&
    order?.payment_status !== 'partially_paid';
  return { isInvoice, isInvoiceMethod };
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
