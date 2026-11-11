/**
 * Receipt/Invoice HTML Generator (Multi-Tenant)
 *
 * Generates a self-contained HTML document styled for PDF export via expo-print.
 * Dynamically adapts to each merchant's brand: logo, colors, business info.
 * Supports paid receipts, unpaid invoices, and partial payment breakdowns.
 */

import { normalizeReceiptColor } from './receipt-colors';
import { renderReceiptDocument } from './receipt-document';
import { renderItemRows } from './receipt-item-rows';
import { createMoneyFormatter, hexToRgba } from './receipt-money';
import { renderBankDetailsHtml } from './receipt-payment-instructions';
import {
  renderFinancialSummaryLines,
  renderInvoiceTermsHtml,
  renderLogoHtml,
  renderPaymentHistoryHtml,
  renderQrHtml,
  renderTermsHtml,
  renderVatBreakdownHtml,
} from './receipt-sections';
import { buildSocialItems } from './receipt-social';
import { getReceiptStatusConfig } from './receipt-status';
import type { ReceiptMerchant, ReceiptOptions, ReceiptOrder } from './types';

function normalizeAddressPart(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function normalizeCountryForComparison(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'ng' || normalized === 'nga') {
    return 'nigeria';
  }

  return normalized.replace(/\b(?:ng|nga)\b/g, 'nigeria');
}

function formatCountryForReceipt(value: string) {
  const normalized = value.trim();
  return normalizeCountryForComparison(normalized) === 'nigeria'
    ? 'Nigeria'
    : normalized;
}

function tokenizeCountryForComparison(value: string) {
  return value.split(/[^a-z0-9]+/i).filter(Boolean);
}

function hasCountryToken(part: string, country: string) {
  const partTokens = tokenizeCountryForComparison(part);
  const countryTokens = tokenizeCountryForComparison(country);

  if (countryTokens.length === 0 || countryTokens.length > partTokens.length) {
    return false;
  }

  return partTokens.some((_token, index) =>
    countryTokens.every((countryToken, offset) => {
      return partTokens[index + offset] === countryToken;
    })
  );
}

function hasAddressPart(parts: string[], value: string, isCountry = false) {
  const normalizedValue = isCountry
    ? normalizeCountryForComparison(value)
    : value.toLowerCase();

  return parts.some((part) => {
    const normalizedPart = isCountry
      ? normalizeCountryForComparison(part)
      : part.toLowerCase();
    return (
      normalizedPart === normalizedValue ||
      (isCountry && hasCountryToken(normalizedPart, normalizedValue))
    );
  });
}

function appendAddressPart(
  parts: string[],
  value: string | null | undefined,
  options: { isCountry?: boolean } = {}
) {
  const normalized = normalizeAddressPart(value);
  const displayValue = options.isCountry
    ? normalized && formatCountryForReceipt(normalized)
    : normalized;
  if (!displayValue || hasAddressPart(parts, displayValue, options.isCountry)) {
    return;
  }

  parts.push(displayValue);
}

const INVOICE_TITLES = new Map([
  ['381', 'Credit Note'],
  ['383', 'Debit Note'],
  ['384', 'Corrected Invoice'],
  ['386', 'Prepayment Invoice'],
  ['389', 'Self-billed Invoice'],
]);

export function generateReceiptHtml(
  order: ReceiptOrder,
  merchant: ReceiptMerchant,
  options: ReceiptOptions = {}
): string {
  const brandPrimary = normalizeReceiptColor(merchant.brand_colors?.primary);
  const brandAccent = normalizeReceiptColor(
    merchant.brand_colors?.accent,
    brandPrimary
  );
  const brandLight = hexToRgba(brandPrimary, 0.06);
  const brandCardBorder = hexToRgba(brandPrimary, 0.12);

  const isPaid = order.payment_status === 'paid';
  const statusConfig = getReceiptStatusConfig(order.payment_status);
  // Explicit invoices can describe paid orders. Proformas apply only to unpaid
  // orders. The default is a receipt for paid orders and an invoice otherwise.
  const isProforma = options.documentKind === 'proforma' && !isPaid;
  const forceInvoice = options.documentKind === 'invoice';
  const invoiceTitle =
    INVOICE_TITLES.get(options.invoiceTypeCode ?? '') ?? 'Invoice';
  const docTitle = isProforma
    ? 'Proforma Invoice'
    : isPaid && !forceInvoice
      ? 'Receipt'
      : invoiceTitle;

  const currencyCode = order.currency || 'NGN';
  const formatMoney = createMoneyFormatter(currencyCode);

  const orderDate = new Date(order.transaction_date ?? order.created_at);
  const hasIssueDate = Boolean(order.invoice_issue_date);
  const dateStr = order.invoice_issue_date
    ? formatReceiptCalendarDate(order.invoice_issue_date)
    : Number.isNaN(orderDate.getTime())
      ? '—'
      : orderDate.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'Africa/Lagos',
        });
  // A persisted issue date is a legal calendar date with no time component.
  // Pairing it with the Lagos transaction time mixes two different moments
  // for backdated invoices and two timezones for non-Nigerian merchants, so
  // render the issue date without a time.
  const timeStr =
    hasIssueDate || Number.isNaN(orderDate.getTime())
      ? ''
      : orderDate.toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Africa/Lagos',
        });

  const storeName =
    merchant.legal_entity_name || merchant.business_name || 'Store';
  // Only the public support email belongs on a customer-facing receipt — never
  // fall back to `merchant.email`, which is the merchant's private login address.
  const contactEmail = merchant.support_email || null;
  const contactPhone = merchant.support_phone || merchant.phone;

  const addr = order.shipping_address;
  const addressParts: string[] = [];
  appendAddressPart(addressParts, addr?.address_line1);
  appendAddressPart(addressParts, addr?.address_line2);
  appendAddressPart(
    addressParts,
    [addr?.city, addr?.state].filter(Boolean).join(', ')
  );
  appendAddressPart(addressParts, addr?.postal_code);
  appendAddressPart(addressParts, addr?.country, { isCountry: true });

  const registeredAddress = merchant.registered_address;
  const invoiceAddress = registeredAddress
    ? [
        registeredAddress.street,
        registeredAddress.city,
        registeredAddress.state,
        registeredAddress.postal_code,
        registeredAddress.country,
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  const displayMerchant =
    docTitle === 'Receipt' || !invoiceAddress
      ? merchant
      : { ...merchant, business_address: invoiceAddress };

  return renderReceiptDocument({
    order,
    merchant: displayMerchant,
    complianceNote: options.complianceNote,
    addressParts,
    bankDetailsHtml: renderBankDetailsHtml({
      order,
      merchant,
      options,
      brandPrimary,
      brandAccent,
      contactEmail,
      contactPhone,
      isPaid,
    }),
    brandCardBorder,
    brandLight,
    brandPrimary,
    contactEmail,
    contactPhone,
    dateStr,
    docTitle,
    isPaid,
    isProforma,
    // The effective kind mirrors docTitle above: VAT detail lines render
    // for invoices and proformas only, like the emailed PDF.
    itemRows: renderItemRows(
      order,
      formatMoney,
      isPaid && !forceInvoice ? 'receipt' : isProforma ? 'proforma' : 'invoice'
    ),
    logoHtml: renderLogoHtml(merchant, storeName, options.svgXml),
    invoiceTermsHtml: renderInvoiceTermsHtml(order, isPaid && !forceInvoice),
    vatBreakdownHtml: renderVatBreakdownHtml(
      order,
      formatMoney,
      isPaid && !forceInvoice
    ),
    paymentHistoryHtml: renderPaymentHistoryHtml(order, formatMoney),
    qrHtml: renderQrHtml(options, isPaid),
    socialItems: buildSocialItems(merchant.social_media),
    statusConfig,
    summaryLines: renderFinancialSummaryLines(
      order,
      merchant,
      formatMoney,
      statusConfig.color,
      isPaid,
      isPaid && !forceInvoice
    ),
    termsHtml: renderTermsHtml(merchant, options),
    timeStr,
  });
}

function formatReceiptCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return '-';

  const [, year, month, day] = match;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${year}-${month}-${day}T12:00:00.000Z`));
}
