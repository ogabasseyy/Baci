import { escapeHtml, escapeJsString } from './escape-html';
import { formatOrderItemDisplayName } from '../lib/order-item-display';
import {
  getReceiptFulfillmentRowsFromDetails,
  getReceiptFulfillmentSummary,
  isDeviceReceiptItemName,
  normalizeReceiptFulfillmentDetails,
  type ReceiptFulfillmentRow,
  resolveReceiptItemFulfillmentDetails,
  shouldAttachFulfillmentToItem,
} from './receipt-fulfillment';
import {
  getReceiptDisplaySubtotal,
  getReceiptVatRate,
  type MoneyFormatter,
  shouldShowVatLine,
} from './receipt-money';

export { renderTermsHtml } from './receipt-terms';

import { sanitizeSvg } from './sanitize-svg';
import type { ReceiptMerchant, ReceiptOptions, ReceiptOrder } from './types';

export function renderLogoHtml(
  merchant: ReceiptMerchant,
  storeName: string,
  svgXml: string | undefined
): string {
  const safeStoreName = escapeHtml(storeName);
  if (svgXml) {
    return `<div class="logo-svg">${sanitizeSvg(svgXml)}</div>`;
  }

  if (merchant.logo_url) {
    const fallbackLogoUrl = `https://placehold.co/200x80?text=${encodeURIComponent(
      storeName
    )}`;
    const fallbackLogoUrlForJs = escapeHtml(escapeJsString(fallbackLogoUrl));
    return `<img src="${escapeHtml(merchant.logo_url)}" alt="${safeStoreName}" class="logo-img" style="display: block !important;" onerror="this.src='${fallbackLogoUrlForJs}'">`;
  }

  return `<div class="logo-fallback">${safeStoreName}</div>`;
}

export function renderItemRows(
  order: ReceiptOrder,
  formatMoney: MoneyFormatter
): string {
  if (order.items.length === 0) {
    const fulfillmentHtml = renderFulfillmentRowsHtml(
      getReceiptFulfillmentRowsFromDetails(order.fulfillment_details)
    );
    return `<tr><td colspan="5" style="text-align:center;padding:16px;color:#9ca3af;">No items${fulfillmentHtml}</td></tr>`;
  }

  const hasDeviceItem = order.items.some((item) =>
    isDeviceReceiptItemName(item.product_name || item.name || '')
  );

  let orderFallbackEmitted = false;

  return order.items
    .map((item, index) => {
      const baseName = item.product_name || item.name || 'Item';
      const itemLabel = formatOrderItemDisplayName({
        baseName,
        condition: item.condition,
        variantName: item.variant_name,
      });

      let fulfillmentHtml = '';
      let fulfillmentSummary: string | null = null;

      const itemFulfillmentDetails = normalizeReceiptFulfillmentDetails(
        item.fulfillment_details
      ) ||
        resolveReceiptItemFulfillmentDetails(
          order.fulfillment_details,
          item
        ) || {
          imei: item.fulfillment_details?.imei || item.imei,
          serialNumber:
            item.fulfillment_details?.serialNumber || item.serialNumber,
          serial_number:
            item.fulfillment_details?.serial_number || item.serial_number,
        };
      const itemSummary = getReceiptFulfillmentSummary({
        imei: itemFulfillmentDetails.imei,
        serialNumber: itemFulfillmentDetails.serialNumber,
        serial_number: itemFulfillmentDetails.serial_number,
      });

      if (itemSummary) {
        fulfillmentSummary = itemSummary;
        fulfillmentHtml = renderFulfillmentRowsHtml(
          getReceiptFulfillmentRowsFromDetails(itemFulfillmentDetails)
        );
      } else if (order.fulfillment_details) {
        const shouldUseOrderFallback = shouldAttachFulfillmentToItem({
          hasDeviceItem,
          index,
          itemName: baseName,
        });
        const orderSummary = getReceiptFulfillmentSummary(
          order.fulfillment_details
        );

        // If an order has only order-level identifiers, attach them to the
        // first item so single-line non-device invoices still show the data.
        if (orderSummary && shouldUseOrderFallback && !orderFallbackEmitted) {
          fulfillmentSummary = orderSummary;
          fulfillmentHtml = renderFulfillmentRowsHtml(
            getReceiptFulfillmentRowsFromDetails(order.fulfillment_details)
          );
          orderFallbackEmitted = true;
        }
      }

      const descriptionHtml = renderItemDescriptionHtml({
        baseName,
        description: item.description,
        fulfillmentSummary,
        itemLabel,
        variantName: item.variant_name ?? undefined,
      });

      return `
      <tr class="${index % 2 === 1 ? 'zebra' : ''}">
        <td class="cell-num">${index + 1}</td>
        <td class="cell-item">
          <div>${escapeHtml(itemLabel)}</div>
          ${descriptionHtml}
          ${fulfillmentHtml}
        </td>
        <td class="cell-qty">${item.quantity}</td>
        <td class="cell-price">${formatMoney(item.price)}</td>
        <td class="cell-total">${formatMoney(item.price * item.quantity)}</td>
      </tr>`;
    })
    .join('');
}

function renderFulfillmentRowsHtml(rows: ReceiptFulfillmentRow[]) {
  if (rows.length === 0) {
    return '';
  }

  return `<div class="cell-fulfillment-grid">${rows
    .map((row) => {
      const accessibleLabel = `${row.label}: ${row.value}`;
      return `<span class="fulfillment-item" aria-label="${escapeHtml(accessibleLabel)}"><span class="fulfillment-key">${escapeHtml(row.label)}</span><span class="fulfillment-val">${escapeHtml(row.value)}</span></span>`;
    })
    .join('')}</div>`;
}

function normalizeDescriptionComparison(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function getItemDescriptionLines({
  baseName,
  description,
  fulfillmentSummary,
  itemLabel,
  variantName,
}: {
  baseName: string;
  description?: string | null;
  fulfillmentSummary: string | null;
  itemLabel: string;
  variantName?: string;
}): string[] {
  if (!description) {
    return [];
  }

  const duplicateValues = [baseName, itemLabel, variantName, fulfillmentSummary]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeDescriptionComparison);

  return description
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter(
      (line) => !duplicateValues.includes(normalizeDescriptionComparison(line))
    );
}

function renderItemDescriptionHtml(
  params: Parameters<typeof getItemDescriptionLines>[0]
) {
  const lines = getItemDescriptionLines(params);
  if (lines.length === 0) {
    return '';
  }

  return `<div class="cell-item-description">${lines.map(escapeHtml).join('<br>')}</div>`;
}

export function renderFinancialSummaryLines(
  order: ReceiptOrder,
  merchant: ReceiptMerchant,
  formatMoney: MoneyFormatter,
  statusColor: string,
  isPaid: boolean
): string[] {
  const summaryLines: string[] = [
    `<div class="sum-row"><span>Subtotal</span><span>${formatMoney(getReceiptDisplaySubtotal(order, merchant))}</span></div>`,
  ];

  if (order.shipping_fee > 0) {
    summaryLines.push(
      `<div class="sum-row"><span>Shipping</span><span>${formatMoney(order.shipping_fee)}</span></div>`
    );
  } else {
    summaryLines.push(
      '<div class="sum-row"><span>Shipping</span><span style="color:#059669;font-weight:600;">Free</span></div>'
    );
  }

  if (order.discount_amount > 0) {
    summaryLines.push(
      `<div class="sum-row"><span>Discount</span><span style="color:#dc2626;font-weight:600;">-${formatMoney(order.discount_amount)}</span></div>`
    );
  }

  if (shouldShowVatLine(order, merchant)) {
    const vatRate = getReceiptVatRate(merchant, order.currency);
    const vatLabel = escapeHtml(vatRate !== null ? `VAT (${vatRate}%)` : 'VAT');
    summaryLines.push(
      `<div class="sum-row"><span>${vatLabel}</span><span>${formatMoney(order.tax_amount)}</span></div>`
    );
  }

  summaryLines.push('<div class="sum-divider"></div>');
  summaryLines.push(
    `<div class="sum-row sum-total"><span>Total</span><span>${formatMoney(order.total)}</span></div>`
  );

  if (!isPaid) {
    if (order.amount_paid > 0) {
      summaryLines.push(
        `<div class="sum-row sum-paid"><span>Amount Paid</span><span style="color:#059669;">-${formatMoney(order.amount_paid)}</span></div>`
      );
    }
    summaryLines.push(
      `<div class="sum-row sum-due"><span>Balance Due</span><span style="color:${statusColor};font-weight:800;">${formatMoney(order.balance)}</span></div>`
    );
  }

  return summaryLines;
}

export function renderPaymentHistoryHtml(
  order: ReceiptOrder,
  formatMoney: MoneyFormatter
): string {
  if (!order.transactions || order.transactions.length === 0) {
    return '';
  }

  const txRows = order.transactions
    .map((tx) => {
      const txDate = new Date(tx.created_at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      const method = tx.metadata?.payment_method || tx.description || 'Payment';
      return `<tr><td>${txDate}</td><td>${escapeHtml(method)}</td><td style="text-align:right;font-weight:600;color:#059669;">${formatMoney(tx.amount)}</td></tr>`;
    })
    .join('');

  return `
      <div class="section-block">
        <div class="section-label">Payment History</div>
        <table class="tx-table">
          <thead><tr><th>Date</th><th>Method</th><th style="text-align:right;">Amount</th></tr></thead>
          <tbody>${txRows}</tbody>
        </table>
      </div>`;
}

export function renderQrHtml(options: ReceiptOptions, isPaid: boolean): string {
  return options.qrCodeDataUri
    ? `<div class="qr-block"><img src="${escapeHtml(options.qrCodeDataUri)}" alt="QR Code" width="100" height="100"><div class="qr-caption">${isPaid ? 'Track your order' : 'Pay online'}</div></div>`
    : '';
}
