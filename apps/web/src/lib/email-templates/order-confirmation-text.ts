import type { OrderConfirmationData } from './order-confirmation';
import {
  buildConfirmationBalanceTextIntro,
  buildProformaNextStepsText,
  buildProformaPaymentText,
  buildProformaTextIntro,
  isBalanceDueConfirmation,
  resolveProformaContext,
} from './order-confirmation-proforma';
import { buildOrderItemsText, formatEmailMoney } from './shared';

/**
 * Plain-text version of the order confirmation. Lives in its own
 * module so the HTML template stays within the 300-line modularity
 * limit; both renderers share the proforma/balance helpers above.
 */
export function generateOrderConfirmationText(
  data: OrderConfirmationData
): string {
  const isProforma = data.documentKind === 'proforma';
  const isPaymentRequest = data.documentKind === 'payment_request';
  const itemsText = buildOrderItemsText(data.items, data.currency);
  const proforma = resolveProformaContext(data);
  const payableNextSteps = buildProformaNextStepsText(data, proforma);
  const textBalanceDue = isBalanceDueConfirmation(data, proforma);

  return `
${isProforma ? 'Proforma Invoice' : isPaymentRequest ? 'Payment Request' : 'Order Confirmed!'}

Hi ${data.customerName},

${
  isProforma || isPaymentRequest
    ? buildProformaTextIntro(data.documentKind, proforma.hasAmountDue)
    : textBalanceDue
      ? buildConfirmationBalanceTextIntro(data, proforma)
      : 'Your order has been confirmed and will be shipped soon.'
}

Order Number: #${data.orderNumber}

Items Ordered:
${itemsText}

Subtotal: ${formatEmailMoney(data.subtotal, data.currency)}
Shipping: ${formatEmailMoney(data.shippingFee, data.currency)}
Total: ${formatEmailMoney(data.total, data.currency)}
${buildProformaPaymentText(data, proforma)}

Shipping Address:
${data.shippingAddress.address}
${data.shippingAddress.city}, ${data.shippingAddress.state}
Phone: ${data.shippingAddress.phone}

What's next?
${
  isProforma || isPaymentRequest || textBalanceDue
    ? payableNextSteps
    : "You'll receive a shipping confirmation email with tracking information once your order is on its way."
}

Visit Store: ${data.merchantUrl}

If you have any questions about your order, please contact ${data.merchantName} directly.

---
Powered by Baci - AI E-commerce Platform
  `.trim();
}
