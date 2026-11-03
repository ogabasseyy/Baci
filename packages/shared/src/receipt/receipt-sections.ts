import { escapeHtml, escapeJsString } from './escape-html';
import { canonicalizeTransactionPaymentMethod } from './manual-order-document-gates';
import {
  reconcileAssuranceTaxSubtotals,
  sumAssuranceFeeTotals,
} from './receipt-assurance';
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
      // Canonical document timezone like the header dates and the emailed
      // PDF: a near-midnight settlement must show the same calendar date
      // for customers outside Lagos instead of the device timezone's day.
      // A null timestamp renders a dash (new Date(null) is the epoch).
      const txDate =
        tx.created_at == null
          ? '-'
          : new Date(tx.created_at).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              timeZone: 'Africa/Lagos',
            });
      const method =
        canonicalizeTransactionPaymentMethod(tx.metadata?.payment_method) ||
        tx.description ||
        'Payment';
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

export function renderVatBreakdownHtml(
  order: ReceiptOrder,
  formatMoney: MoneyFormatter,
  isPaid: boolean
): string {
  // Like the emailed PDF (VAT Breakdown table): invoices and proformas
  // with stored subtotal rows show category totals plus exemption text.
  // Receipts never render it; absent rows render nothing.
  const rows = Array.isArray(order.tax_subtotals) ? order.tax_subtotals : [];
  if (isPaid || rows.length === 0) return '';
  // VAT-free assurance premiums never appear in the stored subtotals:
  // reconcile a copy like the emailed PDF so preview totals match it
  // exactly. Idempotent — pre-reconciled rows pass through untouched.
  const reconciled = rows.map((row) => ({
    ...(typeof row === 'object' && row !== null ? row : {}),
  }));
  reconcileAssuranceTaxSubtotals(
    reconciled,
    Number(
      (
        (order.subtotal ?? 0) +
        (order.shipping_fee ?? 0) -
        (order.discount_amount ?? 0)
      ).toFixed(2)
    ),
    sumAssuranceFeeTotals(Array.isArray(order.items) ? order.items : [])
  );
  const body = reconciled
    .map((row) => {
      if (row == null || typeof row !== 'object') return '';
      const category =
        typeof row.vat_category_code === 'string' &&
        row.vat_category_code.trim() !== ''
          ? row.vat_category_code
          : '-';
      const rate =
        typeof row.vat_rate === 'number' && Number.isFinite(row.vat_rate)
          ? `${row.vat_rate.toFixed(2)}%`
          : '-';
      const label =
        typeof row.exemption_reason === 'string' &&
        row.exemption_reason.trim() !== ''
          ? `${category} (${row.exemption_reason.trim()})`
          : category;
      const money = (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value)
          ? formatMoney(value)
          : '-';
      return `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(rate)}</td><td style="text-align:right;">${money(row.taxable_amount)}</td><td style="text-align:right;">${money(row.tax_amount)}</td></tr>`;
    })
    .join('');
  return `
      <div class="section-block">
        <div class="section-label">VAT Breakdown</div>
        <table class="tx-table">
          <thead><tr><th>Category</th><th>Rate</th><th style="text-align:right;">Taxable Amount</th><th style="text-align:right;">Tax Amount</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
}

export function renderInvoiceTermsHtml(
  order: ReceiptOrder,
  isPaid: boolean
): string {
  // Receipts carry no terms: like the emailed PDF, terms/notes/FIRS
  // render on invoices only so the preview matches the attachment.
  if (isPaid) return '';
  const dueTime = order.payment_due_date
    ? Date.parse(order.payment_due_date)
    : Number.NaN;
  const dueDate = Number.isFinite(dueTime)
    ? new Date(dueTime).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Africa/Lagos',
      })
    : '';
  const note = (order.invoice_note || order.notes || '').trim();
  const termLines = [
    order.buyer_reference
      ? `Buyer Reference: ${escapeHtml(order.buyer_reference)}`
      : '',
    dueDate ? `Due Date: ${dueDate}` : '',
    order.payment_terms
      ? `Payment Terms: ${escapeHtml(order.payment_terms)}`
      : '',
  ].filter(Boolean);
  const firsLines = [
    order.firs_irn?.trim()
      ? `FIRS IRN: ${escapeHtml(order.firs_irn.trim())}`
      : '',
    order.firs_csid?.trim()
      ? `FIRS CSID: ${escapeHtml(order.firs_csid.trim())}`
      : '',
  ].filter(Boolean);
  const block = (label: string, lines: string[]) =>
    `\n      <div class="section-block">\n        <div class="section-label">${label}</div>\n        ${lines.map((line) => `<div>${line}</div>`).join('')}\n      </div>`;
  return (
    (termLines.length > 0 ? block('Invoice Terms', termLines) : '') +
    (note ? block('Notes', [escapeHtml(note)]) : '') +
    (firsLines.length > 0 ? block('FIRS', firsLines) : '')
  );
}

export function renderQrHtml(options: ReceiptOptions, isPaid: boolean): string {
  return options.qrCodeDataUri
    ? `<div class="qr-block"><img src="${escapeHtml(options.qrCodeDataUri)}" alt="QR Code" width="100" height="100"><div class="qr-caption">${isPaid ? 'Track your order' : 'Pay online'}</div></div>`
    : '';
}
