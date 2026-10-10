import { escapeHtmlAttribute, escapeHtmlText } from '@/lib/sanitize';
import { sanitizeUrl } from '@/lib/sanitize-core';
import type { MerchantRegistrationInfo } from './shared';
import { buildEscapedRegistrationLine, formatEmailMoney } from './shared';

interface OrderCancellationData extends MerchantRegistrationInfo {
  orderNumber: string;
  customerName: string;
  items: { name: string; quantity: number; price: number }[];
  totalAmount: number;
  amountPaid: number;
  refundAmount: number;
  cancellationReason?: string;
  cancelledBy: 'merchant' | 'customer';
  merchantName: string;
  merchantUrl: string;
  /**
   * ISO 4217 currency code for this order (e.g. `order.currency`). Required —
   * callers must thread the order's actual currency through; omitting it
   * silently renders NGN for every merchant regardless of their payout
   * currency.
   */
  currency: string;
  supportEmail?: string;
}

/**
 * Generate Order Cancellation email HTML - Premium 2025 Design
 */

export function generateOrderCancellationEmail(
  data: OrderCancellationData
): string {
  const itemsHtml = data.items
    .map(
      (item) => `
    <tr>
      <td style="padding: 10px 16px; border-bottom: 1px solid #f0f0f0; color: #64748b; font-size: 14px; text-decoration: line-through;">
        ${escapeHtmlText(item.name)}
      </td>
      <td style="padding: 10px 16px; border-bottom: 1px solid #f0f0f0; text-align: center; color: #94a3b8; font-size: 14px;">
        x${item.quantity}
      </td>
      <td style="padding: 10px 16px; border-bottom: 1px solid #f0f0f0; text-align: right; color: #94a3b8; font-size: 14px;">
        ${formatEmailMoney(item.price, data.currency)}
      </td>
    </tr>
  `
    )
    .join('');

  const refundSection =
    data.refundAmount > 0
      ? `
    <!-- Refund Info -->
    <div style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border-radius: 12px; padding: 20px; margin: 24px 0; border: 1px solid #a7f3d0;">
      <div style="font-size: 14px; font-weight: 600; color: #065f46; margin-bottom: 8px;">💰 Refund Information</div>
      <table style="width: 100%; font-size: 14px;">
        <tr>
          <td style="padding: 4px 0; color: #6b7280;">Amount Paid</td>
          <td style="padding: 4px 0; text-align: right; color: #1e293b; font-weight: 600;">${formatEmailMoney(data.amountPaid, data.currency)}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #6b7280;">Refund Amount</td>
          <td style="padding: 4px 0; text-align: right; color: #059669; font-weight: 700;">${formatEmailMoney(data.refundAmount, data.currency)}</td>
        </tr>
      </table>
      <p style="margin: 12px 0 0 0; font-size: 13px; color: #047857;">
        Please contact the store for an update on your refund status.
      </p>
    </div>
    `
      : '';

  const reasonSection = data.cancellationReason
    ? `
    <div style="background: #fef2f2; border-radius: 8px; padding: 16px; margin: 16px 0; border: 1px solid #fecaca;">
      <p style="margin: 0; font-size: 14px; color: #991b1b;">
        <strong>Reason:</strong> ${escapeHtmlText(data.cancellationReason)}
      </p>
    </div>
    `
    : '';

  // Extract conditional message for cleaner template (2026 best practice)
  const cancellationMessage =
    data.cancelledBy === 'merchant'
      ? 'We regret to inform you that your order has been cancelled.'
      : 'Your order has been successfully cancelled as requested.';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Cancelled - #${escapeHtmlText(data.orderNumber)}</title>
  <style>
    @media only screen and (max-width: 600px) {
      .container { width: 100% !important; padding: 16px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f1f5f9; -webkit-font-smoothing: antialiased;">

  <div style="max-width: 600px; margin: 40px auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">

    <!-- Header - Muted/Cancelled Theme -->
    <div style="background: linear-gradient(135deg, #64748b 0%, #475569 100%); padding: 40px 30px; text-align: center;">
      <div style="font-size: 48px; margin-bottom: 16px;">❌</div>
      <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">Order Cancelled</h1>
      <p style="margin: 12px 0 0 0; color: #cbd5e1; font-size: 16px;">Order #${escapeHtmlText(data.orderNumber)}</p>
    </div>

    <!-- Body -->
    <div style="padding: 30px;">
      <p style="margin: 0; font-size: 16px; color: #334155; line-height: 1.6;">
        Hi <strong>${escapeHtmlText(data.customerName)}</strong>,
      </p>
      <p style="margin: 16px 0 0 0; font-size: 16px; color: #475569; line-height: 1.6;">
        ${cancellationMessage}
      </p>

      ${reasonSection}

      <!-- Cancelled Items -->
      <div style="background: #f8fafc; border-radius: 12px; padding: 20px; margin: 24px 0; border: 1px solid #e2e8f0;">
        <div style="font-size: 14px; font-weight: 600; color: #475569; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
          📦 Cancelled Items
        </div>
        <table style="width: 100%; border-collapse: collapse;">
          ${itemsHtml}
        </table>
        <table style="width: 100%; margin-top: 16px;">
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Order Total</td>
            <td style="padding: 8px 0; text-align: right; color: #94a3b8; font-size: 14px; text-decoration: line-through;">${formatEmailMoney(data.totalAmount, data.currency)}</td>
          </tr>
        </table>
      </div>

      ${refundSection}

      <!-- Support Note -->
      <div style="background: #f0f9ff; border-radius: 12px; padding: 20px; margin-top: 24px; border: 1px solid #bae6fd;">
        <p style="margin: 0; font-size: 14px; color: #0369a1; line-height: 1.6;">
          <strong>Questions?</strong><br>
          If you have any questions about this cancellation, please don't hesitate to contact us.
        </p>
      </div>
    </div>

    <!-- CTA -->
    <div style="padding: 0 30px 30px 30px; text-align: center;">
      <a href="${escapeHtmlAttribute(sanitizeUrl(data.merchantUrl))}" style="background: #475569; color: #ffffff; padding: 16px 40px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">
        Continue Shopping
      </a>
    </div>

    <!-- Footer -->
    <div style="background: #f8fafc; padding: 24px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0 0 8px 0; font-size: 14px; color: #6b7280;">
        We're sorry this didn't work out. Hope to see you again soon!
      </p>
      ${data.supportEmail ? `<p style="margin: 0 0 8px 0; font-size: 13px; color: #9ca3af;">Contact: ${escapeHtmlText(data.supportEmail)}</p>` : ''}
      ${(() => {
        const reg = buildEscapedRegistrationLine(data);
        return reg
          ? `<p style="margin: 0 0 8px 0; font-size: 12px; color: #9ca3af;">${reg}</p>`
          : '';
      })()}
      <p style="margin: 0; font-size: 12px; color: #9ca3af;">
        Powered by <strong>Baci</strong> — AI E-commerce Platform
      </p>
    </div>

  </div>
</body>
</html>
  `.trim();
}

/**
 * Generate plain text version of order cancellation email
 */

export function generateOrderCancellationText(
  data: OrderCancellationData
): string {
  const itemsList = data.items
    .map(
      (item) =>
        `- ${item.name} x${item.quantity} - ${formatEmailMoney(item.price, data.currency)}`
    )
    .join('\n');

  // Extract conditional strings for cleaner template (2026 best practice)
  const cancellationMessage =
    data.cancelledBy === 'merchant'
      ? 'We regret to inform you that your order has been cancelled.'
      : 'Your order has been successfully cancelled as requested.';

  const reasonLine = data.cancellationReason
    ? `Reason: ${data.cancellationReason}`
    : '';

  const refundSection =
    data.refundAmount > 0
      ? `
REFUND INFORMATION
Amount Paid: ${formatEmailMoney(data.amountPaid, data.currency)}
Refund Amount: ${formatEmailMoney(data.refundAmount, data.currency)}
Please contact the store for an update on your refund status.
`
      : '';

  const contactLine = data.supportEmail
    ? `Questions? Contact us at ${data.supportEmail}.`
    : 'Questions? Contact us.';

  return `
❌ Order Cancelled - #${data.orderNumber}

Hi ${data.customerName},

${cancellationMessage}

${reasonLine}

CANCELLED ITEMS
${itemsList}

Order Total: ${formatEmailMoney(data.totalAmount, data.currency)} (Cancelled)

${refundSection}

${contactLine}

Continue shopping: ${data.merchantUrl}

We're sorry this didn't work out. Hope to see you again soon!

---
Powered by Baci - AI E-commerce Platform
  `.trim();
}
