import { escapeHtmlAttribute, escapeHtmlText } from '@/lib/sanitize';
import { sanitizeUrl } from '@/lib/sanitize-core';
import {
  buildConfirmationBalanceIntroHtml,
  buildConfirmationBalanceTextIntro,
  buildProformaIntroHtml,
  buildProformaNextStepsText,
  buildProformaPaymentHtml,
  buildProformaPaymentText,
  buildProformaTextIntro,
  isBalanceDueConfirmation,
  resolveOrderCtaHref,
  resolveProformaContext,
} from './order-confirmation-proforma';
import type { MerchantRegistrationInfo, OrderItem } from './shared';
import {
  buildOrderItemsHtml,
  buildOrderItemsText,
  buildRegistrationFooterHtml,
  formatEmailMoney,
} from './shared';

interface OrderConfirmationData extends MerchantRegistrationInfo {
  orderNumber: string;
  customerName: string;
  items: OrderItem[];
  subtotal: number;
  shippingFee: number;
  total: number;
  shippingAddress: {
    address: string;
    city: string;
    state: string;
    phone: string;
  };
  merchantName: string;
  merchantUrl: string;
  currency?: string;
  /**
   * Unpaid invoice-method orders are proforma (325) quotations, not
   * confirmed purchases: the body must use quotation semantics to match
   * the "Proforma Invoice Generated" subject. Unpaid Pay for Me orders
   * are payment requests: same transfer-instruction mechanics, but
   * request (not quotation) semantics under their own kind — never
   * collapsed to proforma.
   */
  documentKind?: 'confirmation' | 'proforma' | 'payment_request';
  /**
   * Order-specific tracking URL (see buildOrderTrackingLink: the
   * /track-order page auto-resolves the token or order id plus email
   * pair). The proforma CTA must point here — not at the storefront
   * homepage — so customers can view the quoted invoice from the email.
   * The tracking page shows status only: it cannot take payment, so the
   * body must never promise payment through the link.
   */
  paymentLink?: string;
  /**
   * Dedicated virtual account assigned to an unpaid invoice order. The
   * proforma body renders it as bank-transfer payment instructions —
   * without these details the reader has no way to pay the quote.
   */
  virtualAccount?: {
    bankName: string;
    accountNumber: string;
    accountName: string;
  };
  /**
   * Outstanding balance the transfer instructions charge: the full total
   * minus credit already applied (wallet/savings/partial payment),
   * matching the attached PDF's balance. Defaults to the full total for
   * callers without partial coverage.
   */
  amountDue?: number;
  /**
   * Renders residual-balance transfer instructions on a commercial
   * confirmation (credited-but-unpaid invoice): same mechanics as the
   * proforma block, confirmation copy everywhere else. See
   * ProformaEmailInput for the scoping contract.
   */
  balanceDueInstructions?: boolean;
}

/**
 * Generate order confirmation email HTML - Baci Premium Design 2025
 */

export function generateOrderConfirmationEmail(
  data: OrderConfirmationData
): string {
  const isProforma = data.documentKind === 'proforma';
  const isPaymentRequest = data.documentKind === 'payment_request';
  // The proforma/request CTA opens the order-specific tracking page,
  // which shows status only and cannot take payment (the quote itself
  // travels as the attached PDF): label it as tracking, never as the
  // document. Payment travels by bank transfer (details below).
  const ctaHref = resolveOrderCtaHref(data);
  const proforma = resolveProformaContext(data);
  const proformaPaymentHtml = buildProformaPaymentHtml(data, proforma);
  // A credited-but-unpaid invoice stays a commercial confirmation, but
  // the recipient still needs the outstanding-balance instructions the
  // confirmation path otherwise omits.
  const hasBalanceDue = isBalanceDueConfirmation(data, proforma);
  const proformaIntroHtml = hasBalanceDue
    ? buildConfirmationBalanceIntroHtml(data, proforma)
    : buildProformaIntroHtml(data, proforma);
  const itemsHtml = buildOrderItemsHtml(data.items, data.currency);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isProforma ? `Proforma Invoice #${escapeHtmlText(data.orderNumber)}` : isPaymentRequest ? `Payment Request #${escapeHtmlText(data.orderNumber)}` : `Order Confirmation #${escapeHtmlText(data.orderNumber)}`}</title>
  <style>
    @media only screen and (max-width: 600px) {
      .container { width: 100% !important; padding: 20px !important; }
      .columns { display: block !important; width: 100% !important; padding-bottom: 20px; }
      .invoice-header { flex-direction: column; text-align: left; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f1f5f9; -webkit-font-smoothing: antialiased;">

  <!-- Main Container -->
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f1f5f9; padding: 40px 0;">
    <tr>
      <td align="center">
        <table border="0" cellpadding="0" cellspacing="0" width="600" class="container" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);">

          <!-- Header -->
          <tr>
            <td style="background-color: #0f172a; padding: 40px 40px;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <!-- Brand Name / Logo -->
                  <td align="left" style="color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">
                    ${escapeHtmlText(data.merchantName)}
                  </td>
                  <!-- Date -->
                  <td align="right" style="color: #94a3b8; font-size: 14px;">
                    ${new Date().toLocaleDateString('en-GB')}
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top: 30px;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; line-height: 1.2;">${isProforma ? `Proforma Invoice #${escapeHtmlText(data.orderNumber)}` : isPaymentRequest ? `Payment Request #${escapeHtmlText(data.orderNumber)}` : `Order #${escapeHtmlText(data.orderNumber)} Confirmed`}</h1>
                    <p style="margin: 10px 0 0 0; color: #cbd5e1; font-size: 16px;">${isProforma ? 'A quotation for your review — no payment taken yet' : isPaymentRequest ? 'Share the transfer details below with your payer — no payment taken yet' : hasBalanceDue ? 'Your order is confirmed — an outstanding balance remains' : 'Thank you for your purchase'}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Intro -->
          <tr>
            <td style="padding: 40px 40px 20px 40px;">
              <p style="margin: 0; font-size: 16px; color: #334155; line-height: 1.6;">Hi <strong>${escapeHtmlText(data.customerName)}</strong>,</p>
              <p style="margin: 16px 0 0 0; font-size: 16px; color: #475569; line-height: 1.6;">
                ${isProforma || isPaymentRequest || hasBalanceDue ? proformaIntroHtml : "We've received your order and are getting it ready! Your items are currently <strong>on hold</strong> until we receive payment confirmation (if applicable)."}
              </p>
            </td>
          </tr>

          <!-- Order Items -->
          <tr>
            <td style="padding: 0 40px;">
              <div style="background-color: #f8fafc; border-radius: 8px; padding: 24px; border: 1px solid #e2e8f0;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%">
                  <thead>
                    <tr>
                      <th align="left" style="padding-bottom: 12px; font-size: 12px; text-transform: uppercase; color: #94a3b8; font-weight: 600; border-bottom: 2px solid #e2e8f0;">Item</th>
                      <th align="center" style="padding-bottom: 12px; font-size: 12px; text-transform: uppercase; color: #94a3b8; font-weight: 600; border-bottom: 2px solid #e2e8f0;">Qty</th>
                      <th align="right" style="padding-bottom: 12px; font-size: 12px; text-transform: uppercase; color: #94a3b8; font-weight: 600; border-bottom: 2px solid #e2e8f0;">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${itemsHtml}
                  </tbody>
                </table>

                <!-- Totals -->
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 20px;">
                  <tr>
                    <td align="right" style="padding-top: 8px; color: #64748b; font-size: 14px;">Subtotal</td>
                    <td align="right" style="padding-top: 8px; width: 120px; font-weight: 600; color: #334155; font-size: 14px;">${formatEmailMoney(data.subtotal, data.currency)}</td>
                  </tr>
                  <tr>
                    <td align="right" style="padding-top: 8px; color: #64748b; font-size: 14px;">Shipping</td>
                    <td align="right" style="padding-top: 8px; width: 120px; font-weight: 600; color: #334155; font-size: 14px;">${formatEmailMoney(data.shippingFee, data.currency)}</td>
                  </tr>
                  <tr>
                    <td align="right" style="padding-top: 16px; color: #0f172a; font-size: 16px; font-weight: 700;">Total</td>
                    <td align="right" style="padding-top: 16px; width: 120px; color: #ca8a04; font-size: 18px; font-weight: 800;">${formatEmailMoney(data.total, data.currency)}</td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>
          ${proformaPaymentHtml}

          <!-- Addresses -->
          <tr>
            <td style="padding: 40px;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <!-- Billing -->
                  <td valign="top" class="columns" width="48%" style="padding-right: 2%;">
                    <h3 style="margin: 0 0 12px 0; font-size: 14px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px;">Billing Info</h3>
                    <p style="margin: 0; font-size: 15px; color: #334155; line-height: 1.5; font-weight: 600;">${escapeHtmlText(data.customerName)}</p>
                    <p style="margin: 4px 0 0 0; font-size: 14px; color: #64748b; line-height: 1.5;">${escapeHtmlText(data.shippingAddress.phone)}</p>
                  </td>

                  <!-- Shipping -->
                  <td valign="top" class="columns" width="48%" style="padding-left: 2%;">
                    <h3 style="margin: 0 0 12px 0; font-size: 14px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px;">Shipping Info</h3>
                    <p style="margin: 0; font-size: 15px; color: #334155; line-height: 1.5; font-weight: 600;">${escapeHtmlText(data.customerName)}</p>
                    <p style="margin: 4px 0 0 0; font-size: 14px; color: #64748b; line-height: 1.5;">
                      ${escapeHtmlText(data.shippingAddress.address)}<br>
                      ${escapeHtmlText(data.shippingAddress.city)}, ${escapeHtmlText(data.shippingAddress.state)}<br>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding: 0 40px 40px 40px;">
              <a href="${escapeHtmlAttribute(sanitizeUrl(ctaHref))}" style="background-color: #0f172a; color: #ffffff; padding: 16px 40px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.2);">
                ${isProforma || isPaymentRequest ? 'Track Order Status' : 'View Order'}
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 30px 40px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; font-size: 14px; color: #64748b;">
                Questions? Reply to this email or contact us at <a href="${escapeHtmlAttribute(sanitizeUrl(data.merchantUrl))}" style="color: #ca8a04; text-decoration: none;">${escapeHtmlText(data.merchantName)}</a>
              </p>
              ${buildRegistrationFooterHtml(data)}
              <p style="margin: 20px 0 0 0; font-size: 12px; color: #94a3b8;">
                &copy; ${new Date().getFullYear()} ${escapeHtmlText(data.merchantName)}. Powered by <strong>Baci</strong>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
  `.trim();
}

/**
 * Generate plain text version of order confirmation
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
