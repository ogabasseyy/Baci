import { formatDisplayCurrency } from '@/lib/format-display-currency';
import { escapeHtmlAttribute, escapeHtmlText } from '@/lib/sanitize';
import { sanitizeUrl } from '@/lib/sanitize-core';

export interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

export interface MerchantRegistrationInfo {
  merchantTin?: string;
  merchantRcNumber?: string;
}

export interface PaymentReminderItem {
  name: string;
  quantity: number;
  price: number;
}

export function formatEmailMoney(amount: number, currency?: string): string {
  return formatDisplayCurrency(amount, currency || 'NGN');
}

export function getSafeHttpUrl(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  return sanitizeUrl(value) || undefined;
}

export function buildOrderItemsHtml(
  items: OrderItem[],
  currency?: string
): string {
  return items
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
        ${formatEmailMoney(item.price, currency)}
      </td>
    </tr>
  `
    )
    .join('');
}

export function buildOrderItemsText(
  items: OrderItem[],
  currency?: string
): string {
  return items
    .map(
      (item) =>
        `${item.name} x${item.quantity} - ${formatEmailMoney(item.price, currency)}`
    )
    .join('\n');
}

export function buildRegistrationFooterHtml(
  data: MerchantRegistrationInfo
): string {
  const reg = buildEscapedRegistrationLine(data);
  return reg
    ? `<p style="margin: 8px 0 0 0; font-size: 12px; color: #94a3b8;">${reg}</p>`
    : '';
}

export function buildEscapedRegistrationLine(
  data: MerchantRegistrationInfo
): string {
  const parts: string[] = [];
  if (data.merchantRcNumber) {
    parts.push(`RC: ${escapeHtmlAttribute(data.merchantRcNumber)}`);
  }
  if (data.merchantTin) {
    parts.push(`TIN: ${escapeHtmlAttribute(data.merchantTin)}`);
  }
  return parts.join(' &middot; ');
}
