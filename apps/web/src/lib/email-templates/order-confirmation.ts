import { escapeHtmlAttribute, escapeHtmlText } from '@/lib/sanitize';
import { sanitizeUrl } from '@/lib/sanitize-core';
import type { MerchantRegistrationInfo, OrderItem } from './shared';
import { buildEscapedRegistrationLine, formatEmailMoney } from './shared';

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
   * the "Proforma Invoice Generated" subject.
   */
  documentKind?: 'confirmation' | 'proforma';
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
}

/**
 * Generate order confirmation email HTML - Baci Premium Design 2025
 */

export function generateOrderConfirmationEmail(
  data: OrderConfirmationData
): string {
  const isProforma = data.documentKind === 'proforma';
  // The proforma CTA opens the order-specific tracking page so customers
  // can view the quote; the tracking page shows status only and cannot
  // take payment, so payment travels by bank transfer (details below).
  const ctaHref =
    isProforma && data.paymentLink ? data.paymentLink : data.merchantUrl;
  // Transfer instructions charge the outstanding balance only: credit
  // already applied must not be charged again (P1 overpayment guard).
  const transferAmount = data.amountDue ?? data.total;
  // Paystack DVAs settle in NGN only: a foreign-currency quote falls back
  // to merchant-contact instructions even if a stale account object is
  // passed — never print a naira account beside a dollar amount.
  const dvaCurrencyCompatible =
    !data.currency || data.currency.trim().toUpperCase() === 'NGN';
  const proformaVirtualAccount = dvaCurrencyCompatible
    ? data.virtualAccount
    : undefined;
  const proformaPaymentHtml =
    isProforma && proformaVirtualAccount
      ? `
          <!-- Payment Instructions -->
          <tr>
            <td style="padding: 0 40px 8px 40px;">
              <div style="background-color: #fefce8; border-radius: 8px; padding: 24px; border: 1px solid #fde68a;">
                <h3 style="margin: 0 0 12px 0; font-size: 14px; text-transform: uppercase; color: #92400e; letter-spacing: 0.5px;">💳 Complete Your Bank Transfer</h3>
                <p style="margin: 0 0 12px 0; font-size: 14px; color: #78350f; line-height: 1.6;">
                  Transfer <strong>${formatEmailMoney(transferAmount, data.currency)}</strong> to the dedicated account below. Your order is confirmed automatically once payment is received.
                </p>
                <table border="0" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td style="color: #92400e; padding: 4px 0; font-size: 14px;">Bank:</td>
                    <td style="color: #1e293b; font-weight: 600; text-align: right; font-size: 14px;">${escapeHtmlText(proformaVirtualAccount.bankName)}</td>
                  </tr>
                  <tr>
                    <td style="color: #92400e; padding: 4px 0; font-size: 14px;">Account Name:</td>
                    <td style="color: #1e293b; font-weight: 600; text-align: right; font-size: 14px;">${escapeHtmlText(proformaVirtualAccount.accountName)}</td>
                  </tr>
                  <tr>
                    <td style="color: #92400e; padding: 4px 0; font-size: 14px;">Account Number:</td>
                    <td style="color: #1e293b; font-weight: 700; text-align: right; font-size: 16px;">${escapeHtmlText(proformaVirtualAccount.accountNumber)}</td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>
  `
      : '';
  const itemsHtml = data.items
    .map(
      (item) => `
    <tr>
      <td style="padding: 16px 0; border-bottom: 1px solid #e2e8f0;">
        <div style="font-weight: 600; color: #1e293b; font-size: 14px;">${escapeHtmlText(item.name)}</div>
      </td>
      <td style="padding: 16px 0; border-bottom: 1px solid #e2e8f0; text-align: center; color: #64748b; font-size: 14px;">
        ${item.quantity}
      </td>
      <td style="padding: 16px 0; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 600; color: #1e293b; font-size: 14px;">
        ${formatEmailMoney(item.price, data.currency)}
      </td>
    </tr>
  `
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isProforma ? `Proforma Invoice #${escapeHtmlText(data.orderNumber)}` : `Order Confirmation #${escapeHtmlText(data.orderNumber)}`}</title>
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
                    <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; line-height: 1.2;">${isProforma ? `Proforma Invoice #${escapeHtmlText(data.orderNumber)}` : `Order #${escapeHtmlText(data.orderNumber)} Confirmed`}</h1>
                    <p style="margin: 10px 0 0 0; color: #cbd5e1; font-size: 16px;">${isProforma ? 'A quotation for your review — no payment taken yet' : 'Thank you for your purchase'}</p>
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
                ${isProforma ? `This proforma invoice is a quotation for the items below. Your order will be processed once payment is received — please share it with your procurement team and ${proformaVirtualAccount ? 'complete your bank transfer using the payment details in this email' : `contact ${escapeHtmlText(data.merchantName)} for payment details`}.` : "We've received your order and are getting it ready! Your items are currently <strong>on hold</strong> until we receive payment confirmation (if applicable)."}
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
                ${isProforma ? 'View Proforma Invoice' : 'View Order'}
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 30px 40px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; font-size: 14px; color: #64748b;">
                Questions? Reply to this email or contact us at <a href="${escapeHtmlAttribute(sanitizeUrl(data.merchantUrl))}" style="color: #ca8a04; text-decoration: none;">${escapeHtmlText(data.merchantName)}</a>
              </p>
              ${(() => {
                const reg = buildEscapedRegistrationLine(data);
                return reg
                  ? `<p style="margin: 8px 0 0 0; font-size: 12px; color: #94a3b8;">${reg}</p>`
                  : '';
              })()}
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
  const itemsText = data.items
    .map(
      (item) =>
        `${item.name} x${item.quantity} - ${formatEmailMoney(item.price, data.currency)}`
    )
    .join('\n');
  // The tracking link shows status only and cannot take payment: the next
  // steps must route payment through the bank-transfer details (or the
  // merchant when no account was assigned), never through the link.
  const transferAmount = data.amountDue ?? data.total;
  // Same NGN-only gate as the HTML body: a foreign-currency quote falls
  // back to merchant-contact instructions.
  const dvaCurrencyCompatible =
    !data.currency || data.currency.trim().toUpperCase() === 'NGN';
  const proformaVirtualAccount = dvaCurrencyCompatible
    ? data.virtualAccount
    : undefined;
  const proformaNextSteps = [
    proformaVirtualAccount
      ? `Complete your bank transfer of ${formatEmailMoney(transferAmount, data.currency)} using the payment details above — your order is confirmed automatically once payment is received.`
      : `No payment account was assigned to this quote yet — please contact ${data.merchantName} for payment details.`,
    data.paymentLink ? `Track its status here:\n${data.paymentLink}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return `
${isProforma ? 'Proforma Invoice' : 'Order Confirmed!'}

Hi ${data.customerName},

${
  isProforma
    ? 'This proforma invoice is a quotation, not a confirmed order. Your order will be processed once payment is received.'
    : 'Your order has been confirmed and will be shipped soon.'
}

Order Number: #${data.orderNumber}

Items Ordered:
${itemsText}

Subtotal: ${formatEmailMoney(data.subtotal, data.currency)}
Shipping: ${formatEmailMoney(data.shippingFee, data.currency)}
Total: ${formatEmailMoney(data.total, data.currency)}
${
  isProforma && proformaVirtualAccount
    ? `
Payment Details (bank transfer):
Bank: ${proformaVirtualAccount.bankName}
Account Name: ${proformaVirtualAccount.accountName}
Account Number: ${proformaVirtualAccount.accountNumber}`
    : ''
}

Shipping Address:
${data.shippingAddress.address}
${data.shippingAddress.city}, ${data.shippingAddress.state}
Phone: ${data.shippingAddress.phone}

What's next?
${
  isProforma
    ? proformaNextSteps
    : "You'll receive a shipping confirmation email with tracking information once your order is on its way."
}

Visit Store: ${data.merchantUrl}

If you have any questions about your order, please contact ${data.merchantName} directly.

---
Powered by Baci - AI E-commerce Platform
  `.trim();
}
