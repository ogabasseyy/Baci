import { escapeHtml } from './escape-html';
import type { ReceiptStatusConfig } from './receipt-status';
import { getReceiptStyles } from './receipt-styles';
import type { ReceiptMerchant, ReceiptOrder } from './types';

export interface ReceiptDocumentParams {
  order: ReceiptOrder;
  merchant: ReceiptMerchant;
  addressParts: string[];
  bankDetailsHtml: string;
  brandCardBorder: string;
  brandLight: string;
  brandPrimary: string;
  contactEmail: string | null;
  contactPhone: string | null;
  dateStr: string;
  docTitle: string;
  isPaid: boolean;
  isProforma: boolean;
  itemRows: string;
  logoHtml: string;
  paymentHistoryHtml: string;
  qrHtml: string;
  socialItems: string[];
  statusConfig: ReceiptStatusConfig;
  summaryLines: string[];
  termsHtml: string;
  timeStr: string;
}

export function renderReceiptDocument(params: ReceiptDocumentParams): string {
  const {
    order,
    merchant,
    addressParts,
    bankDetailsHtml,
    brandCardBorder,
    brandLight,
    brandPrimary,
    contactEmail,
    contactPhone,
    dateStr,
    docTitle,
    isPaid,
    isProforma,
    itemRows,
    logoHtml,
    paymentHistoryHtml,
    qrHtml,
    socialItems,
    statusConfig,
    summaryLines,
    termsHtml,
    timeStr,
  } = params;
  const footerHtml = renderFooterHtml({
    merchant,
    contactEmail,
    socialItems,
  });
  const paymentMethodLabel = formatReceiptPaymentMethod(
    order.payment_method,
    isPaid
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=794">
<style>${getReceiptStyles({
    brandPrimary,
    brandLight,
    brandCardBorder,
    statusConfig,
  })}</style>
</head>
<body>
<div class="page">
  <div class="accent-bar"></div>
  <div class="content">
    <div class="header">
      <div>
        ${logoHtml}
        <div class="merchant-contact">
          ${merchant.business_address ? `<div>${escapeHtml(merchant.business_address)}</div>` : ''}
          ${contactPhone ? `<div>${escapeHtml(contactPhone)}</div>` : ''}
          ${contactEmail ? `<div>${escapeHtml(contactEmail)}</div>` : ''}
          ${merchant.cac_rc_number ? `<div><strong>RC: ${escapeHtml(merchant.cac_rc_number)}</strong></div>` : ''}
        </div>
      </div>
      <div class="doc-meta">
        <div class="doc-title">${docTitle}</div>
        <div class="doc-number">#${escapeHtml(order.order_number)}</div>
        <div class="doc-date">${dateStr} &middot; ${timeStr}</div>
        <div class="status-badge">${statusConfig.label}</div>
      </div>
    </div>

    <div class="info-grid">
      <div class="info-col">
        <div class="info-label">Billed To</div>
        <div class="info-name">${escapeHtml(order.customer_name)}</div>
        <div class="info-detail">
          ${addressParts.map((part) => `<div>${escapeHtml(part)}</div>`).join('')}
          ${order.customer_phone ? `<div>${escapeHtml(order.customer_phone)}</div>` : ''}
          ${order.customer_email ? `<div>${escapeHtml(order.customer_email)}</div>` : ''}
        </div>
      </div>
      <div class="info-col info-col-right">
        <div class="info-label">${isPaid ? 'Payment' : isProforma ? 'Proforma Info' : 'Invoice Info'}</div>
        <div class="info-name">${escapeHtml(paymentMethodLabel)}</div>
        <div class="info-detail">
          <div>${docTitle} #${escapeHtml(order.order_number)}</div>
          <div>${dateStr}</div>
          ${order.is_credit_order ? '<div style="color:#d97706;font-weight:600;">Credit Order</div>' : ''}
        </div>
      </div>
    </div>

    <div class="items-wrapper">
      <div class="watermark">${statusConfig.label}</div>
      <table class="items-table">
        <thead>
          <tr>
            <th style="text-align:center;">#</th>
            <th>Item</th>
            <th style="text-align:center;">Qty</th>
            <th style="text-align:right;">Price</th>
            <th style="text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>

      <div class="summary">
        <div class="summary-inner">
          ${summaryLines.join('\n          ')}
        </div>
      </div>
    </div>

    ${paymentHistoryHtml}
    ${bankDetailsHtml}
    ${qrHtml}

    <div class="footer-area">
      ${termsHtml}
      ${footerHtml}
      <div class="powered">Powered by Baci &middot; usebaci.com</div>
    </div>
  </div>
</div>
</body>
</html>`;
}

function formatReceiptPaymentMethod(
  paymentMethod: string | null,
  isPaid: boolean
) {
  if (!isPaid) {
    return 'Pending';
  }

  const normalizedMethod = paymentMethod?.trim().toLowerCase();
  if (!normalizedMethod) {
    return 'Verified';
  }

  if (normalizedMethod === 'imported' || normalizedMethod === 'bank_transfer') {
    return 'Bank Transfer';
  }

  if (normalizedMethod === 'transfer' || normalizedMethod === 'bank-transfer') {
    return 'Bank Transfer';
  }

  return formatSentenceCasePaymentMethod(paymentMethod) || 'Verified';
}

function formatSentenceCasePaymentMethod(paymentMethod: string | null) {
  const normalized = paymentMethod?.trim().replace(/[_-]+/g, ' ');
  if (!normalized) {
    return '';
  }

  if (normalized.toLowerCase() === 'pos') {
    return 'POS';
  }

  const lowerCaseLabel = normalized.toLowerCase();
  return lowerCaseLabel.charAt(0).toUpperCase() + lowerCaseLabel.slice(1);
}

function renderFooterHtml({
  merchant,
  contactEmail,
  socialItems,
}: Pick<
  ReceiptDocumentParams,
  'merchant' | 'contactEmail' | 'socialItems'
>): string {
  const allItems: string[] = [];
  if (contactEmail) {
    allItems.push(
      `<span class="footer-item"><span class="footer-email-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg></span><a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a></span>`
    );
  }
  allItems.push(...socialItems);
  if (merchant.cac_rc_number) {
    allItems.push(
      `<span class="footer-item">RC: ${escapeHtml(merchant.cac_rc_number)}</span>`
    );
  }
  if (merchant.tax_identification_number) {
    allItems.push(
      `<span class="footer-item">TIN: ${escapeHtml(merchant.tax_identification_number)}</span>`
    );
  }

  return allItems.length > 0
    ? `<div class="footer-row">${allItems.join('<span class="footer-sep">&middot;</span>')}</div>`
    : '';
}
