const FALLBACK_DELIVERY_ESTIMATE = 'Shared after order confirmation';

export function getOrderSuccessTone(paymentMethod?: string, isPaid = false) {
  // A paid invoice order is a commercial invoice/receipt, not a proforma:
  // match the web success page, which keys proforma copy off unpaid state.
  if (paymentMethod === 'invoice' && !isPaid) {
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

  if (paymentMethod === 'payforme') {
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
