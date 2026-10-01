import {
  renderReceiptCta,
  renderReceiptDeviceRows,
  renderReceiptEmailHtml,
} from '@/lib/import-notifications/import-notification-email-template';
import { escapeHtmlAttribute } from '@/lib/sanitize';
import { sanitizeUrl } from '@/lib/sanitize-core';

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
  const optionalAppHtml = appLinks.length
    ? `<p>Optional: download the app, then sign in with the same verified email to see your linked purchases. ${appLinks.map(([label, url]) => `<a href="${escapeText(url ?? '')}">${label}</a>`).join(' | ')}</p>`
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
      introHtml: `<p>Your PDF ${kindLabel} is attached.</p><p>${escapeText(disclaimer)}</p><p>${escapeText(verification)}</p>${optionalAppHtml}`,
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
