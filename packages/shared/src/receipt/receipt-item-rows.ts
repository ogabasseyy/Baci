import { formatOrderItemDisplayName } from '../lib/order-item-display';
import { escapeHtml } from './escape-html';
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
  getReceiptItemDetailLines,
  getReceiptItemLineTotal,
  getReceiptItemVatLines,
  type MoneyFormatter,
} from './receipt-money';
import type { ReceiptDocumentKind, ReceiptOrder } from './types';

// Item-line rendering for the shared receipt HTML, split out so the
// section module stays under the 300-line gate. Line math and labels
// come from the shared receipt-money helpers the emailed PDF consumes
// too, so the preview can never disagree with the sent document.

function renderReceiptItemMetaHtml(
  item: ReceiptOrder['items'][number],
  formatMoney: MoneyFormatter,
  documentKind: ReceiptDocumentKind
): string {
  // Line math and labels come from the shared receipt-money helpers the
  // emailed PDF consumes too, so the preview can never disagree with the
  // sent document. VAT lines are invoice-only like the PDF's isInvoice
  // gate: receipt previews must not show VAT detail the receipt
  // artifact omits.
  const lines = [
    ...getReceiptItemDetailLines(item),
    ...(documentKind === 'receipt'
      ? []
      : getReceiptItemVatLines(item, formatMoney)),
  ];
  if (lines.length === 0) return '';
  return `<div class="cell-line-meta">${lines
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join('')}</div>`;
}

export function renderItemRows(
  order: ReceiptOrder,
  formatMoney: MoneyFormatter,
  documentKind: ReceiptDocumentKind
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
          ${renderReceiptItemMetaHtml(item, formatMoney, documentKind)}
          ${fulfillmentHtml}
        </td>
        <td class="cell-qty">${item.quantity}</td>
        <td class="cell-price">${formatMoney(item.price)}</td>
        <td class="cell-total">${formatMoney(getReceiptItemLineTotal(item))}</td>
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
