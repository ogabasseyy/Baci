import type { z } from 'zod';
import {
  OGABASSEY_STOREFRONT_APP_STORE_URL,
  OGABASSEY_STOREFRONT_PLAY_STORE_URL,
} from '@/config/platform';
import {
  renderReceiptCta,
  renderReceiptDeviceRows,
  renderReceiptEmailHtml,
} from '@/lib/import-notifications/import-notification-email-template';
import { escapeHtmlAttribute } from '@/lib/sanitize';
import { sanitizeUrl } from '@/lib/sanitize-core';
import type { manualDocumentMerchantSchema } from '@/schemas/manual-order-document-merchant';
import type { manualDocumentOrderSchema } from '@/schemas/manual-order-document-order';

interface ManualDocumentEmailInput {
  merchantName: string;
  customerName: string;
  customerEmail: string;
  orderNumber: string;
  documentKind: 'invoice' | 'proforma_invoice' | 'receipt';
  claimUrl: string;
  devices: string[];
  brandColor?: string | null;
  supportEmail: string;
  appLinks: { appStoreUrl: string; playStoreUrl: string } | null;
}

export function buildManualOrderDocumentEmail(input: ManualDocumentEmailInput) {
  const escapeText = escapeHtmlAttribute;
  const kind = input.documentKind;
  const kindLabel = kind === 'proforma_invoice' ? 'proforma invoice' : kind;
  // Staff-entered order numbers are untrusted in header-adjacent fields:
  // strip line breaks that could smuggle extra subject lines, then cap the
  // reference length.
  const orderNumber = input.orderNumber.replace(/[\r\n]/g, '').slice(0, 64);
  const color = /^#[a-f0-9]{6}$/i.test(input.brandColor ?? '')
    ? (input.brandColor as string)
    : '#111827';
  const claimUrl = sanitizeUrl(input.claimUrl) || '';
  const appLinks = input.appLinks
    ? [
        ['App Store', sanitizeUrl(input.appLinks.appStoreUrl)],
        ['Google Play', sanitizeUrl(input.appLinks.playStoreUrl)],
      ].filter((link) => link[1])
    : [];
  const verification = `Sign in or register and verify ${input.customerEmail} to link this purchase to your account and view or download your ${kindLabel}.`;
  const disclaimer =
    kind === 'receipt'
      ? 'Your PDF receipt is attached. No app installation is needed to keep your proof of payment.'
      : 'This invoice shows the amount paid and outstanding balance. It is not proof of payment in full.';
  // The template wraps introHtml in its own <p>: pass phrasing content only,
  // like the import-notification callers, so parsers keep the styled wrapper.
  const optionalAppHtml = appLinks.length
    ? `<br><br>Optional: download the app, then sign in with the same verified email to see your linked purchases. ${appLinks.map(([label, url]) => `<a href="${escapeText(url ?? '')}">${label}</a>`).join(' | ')}`
    : '';
  return {
    subject: `Your ${kindLabel} is ready - #${orderNumber}`,
    textContent: [
      `Hello ${input.customerName},`,
      `Your ${input.merchantName} ${kindLabel} for order #${orderNumber} is ready.`,
      kind === 'receipt'
        ? 'Your PDF receipt is attached.'
        : 'Your PDF invoice is attached.',
      disclaimer,
      verification,
      `View or download: ${claimUrl}`,
      ...input.devices,
      ...(appLinks.length
        ? [
            'Optional app download (sign in with the same verified email after linking your purchase):',
            ...appLinks.map(([label, url]) => `${label}: ${url}`),
          ]
        : []),
      `Need help? ${input.supportEmail}`,
    ].join('\n\n'),
    htmlContent: renderReceiptEmailHtml({
      preheader: `Your ${kindLabel} for order #${escapeText(orderNumber)} is ready.`,
      brandWordmark: escapeText(input.merchantName),
      brandColor: color,
      eyebrow: kindLabel.toUpperCase(),
      headline: `Your ${kindLabel} is ready`,
      subhead: `Order #${escapeText(orderNumber)}`,
      greetingName: escapeText(input.customerName),
      introHtml: `Your PDF ${kindLabel} is attached.<br><br>${escapeText(disclaimer)}<br><br>${escapeText(verification)}${optionalAppHtml}`,
      sectionLabel: 'Your purchase',
      deviceRowsHtml: renderReceiptDeviceRows(
        input.devices.map(escapeText),
        color
      ),
      ctaHtml: renderReceiptCta(
        escapeText(claimUrl),
        `View / download ${kindLabel}`,
        color
      ),
      reassurance:
        'Use the email address you provided when making this purchase.',
      supportLineHtml: `Need help? ${escapeText(input.supportEmail)}`,
      footerNote: escapeText(input.merchantName),
    }),
  };
}

export interface ManualOrderDocumentContentInput {
  order: z.infer<typeof manualDocumentOrderSchema>;
  merchant: z.infer<typeof manualDocumentMerchantSchema>;
  recipientEmail: string;
  displayCustomerName: string;
  pdfDocumentKind: 'invoice' | 'proforma_invoice' | 'receipt';
  claimUrl: string;
}

export function buildManualOrderDocumentEmailContent(
  input: ManualOrderDocumentContentInput
) {
  const { order, merchant } = input;
  return buildManualOrderDocumentEmail({
    merchantName: merchant.business_name || merchant.slug,
    customerName: input.displayCustomerName,
    customerEmail: input.recipientEmail,
    orderNumber: order.order_number,
    documentKind: input.pdfDocumentKind,
    claimUrl: input.claimUrl,
    devices: order.order_items.map(
      (item) =>
        `${item.quantity > 1 ? `${item.quantity} x ` : ''}${item.name}${item.variant_name ? ` (${item.variant_name})` : ''}`
    ),
    brandColor: merchant.brand_colors?.primary,
    // Visible support copy shows the public support address only: merchant.email
    // is the private login address and never renders on customer documents.
    supportEmail: merchant.support_email || 'the store team',
    appLinks:
      merchant.slug === 'ogabassey'
        ? {
            appStoreUrl: OGABASSEY_STOREFRONT_APP_STORE_URL,
            playStoreUrl: OGABASSEY_STOREFRONT_PLAY_STORE_URL,
          }
        : null,
  });
}
