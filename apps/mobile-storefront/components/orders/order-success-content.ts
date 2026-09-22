const FALLBACK_DELIVERY_ESTIMATE = 'Shared after order confirmation';

// Methods settled after checkout (an external payer or procurement team
// pays later): the success screen must resolve the authoritative paid
// state for these instead of trusting the checkout-time presentation.
const DEFERRED_SETTLEMENT_METHODS = new Set(['invoice', 'payforme']);

export function isDeferredSettlementMethod(paymentMethod?: string): boolean {
  return !!paymentMethod && DEFERRED_SETTLEMENT_METHODS.has(paymentMethod);
}

export function getOrderSuccessTone(
  paymentMethod?: string,
  isPaid = false,
  isCommercialDocument = false
) {
  // A paid invoice order is a commercial invoice/receipt, not a proforma:
  // match the web success page, which keys proforma copy off unpaid state.
  if (paymentMethod === 'invoice' && !isPaid) {
    // Partial payment or pre-gateway credit already accepted value, so
    // the generated preview is a commercial invoice: the screen must
    // agree instead of borrowing proforma copy for a commercial
    // document. The order stays active (unlike paid), so the copy
    // names the outstanding balance rather than a receipt.
    if (isCommercialDocument) {
      return {
        documentLabel: 'View / Download Invoice',
        eyebrow: 'Invoice ready',
        nextDocumentText:
          'Your invoice reflects the payments received so far. Complete the outstanding balance to finalize your order.',
        nextDocumentTitle: 'Invoice',
        subtitle:
          "We've credited your payments so far. Complete the outstanding balance and we'll begin processing.",
        title: 'Invoice Ready',
      };
    }
    return {
      documentLabel: 'View / Download Proforma Invoice',
      eyebrow: 'Proforma invoice ready',
      nextDocumentText:
        'Your proforma invoice is ready now. Share it with your company or procurement team.',
      nextDocumentTitle: 'Proforma Invoice',
      subtitle:
        "We've prepared your proforma invoice. Share it with your company or procurement team.",
      title: 'Proforma Invoice Ready!',
    };
  }

  // A settled Pay for Me order is a confirmed order with a receipt, not
  // an open payment request: paid state wins over the request copy.
  if (paymentMethod === 'payforme' && !isPaid) {
    return {
      documentLabel: 'View / Download Invoice',
      eyebrow: 'Payment request ready',
      nextDocumentText:
        'The invoice remains available while this payment request is open.',
      nextDocumentTitle: 'Invoice',
      subtitle:
        "We've saved this order for your payer. Once it is settled, we'll confirm it and begin processing.",
      title: 'Payment Request Created',
    };
  }

  return {
    documentLabel: 'View Receipt',
    eyebrow: 'Order confirmed',
    nextDocumentText:
      'Your receipt is ready to preview and share once the order record is available.',
    nextDocumentTitle: 'Receipt',
    subtitle:
      "Thanks for your order. We'll send a confirmation email and keep you updated as it moves.",
    title: 'Order Confirmed',
  };
}

export function resolveOrderSuccessDeliveryEstimate(value?: string) {
  return value?.trim() || FALLBACK_DELIVERY_ESTIMATE;
}

export function getOrderSuccessDeliveryLabel(value?: string) {
  return value?.trim() ? 'Estimated Delivery' : 'Delivery Timeline';
}
