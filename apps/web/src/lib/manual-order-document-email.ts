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
  documentKind: 'invoice' | 'receipt';
  claimUrl: string;
  devices: string[];
  brandColor?: string | null;
  supportEmail: string;
  appLinks: { appStoreUrl: string; playStoreUrl: string } | null;
}

export function buildManualOrderDocumentEmail(input: ManualDocumentEmailInput) {
  const escapeText = escapeHtmlAttribute;
  const kind = input.documentKind;
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
  const verification = `Sign in or register and verify ${input.customerEmail} to link this purchase to your account and view or download your ${kind}.`;
  const disclaimer =
    kind === 'invoice'
      ? 'This invoice shows the amount paid and outstanding balance. It is not proof of payment in full.'
      : 'Your PDF receipt is attached. No app installation is needed to keep your proof of payment.';
  const optionalAppHtml = appLinks.length
    ? `<p>Optional: download the app, then sign in with the same verified email to see your linked purchases. ${appLinks.map(([label, url]) => `<a href="${escapeText(url ?? '')}">${label}</a>`).join(' | ')}</p>`
    : '';
  return {
    subject: `Your ${kind} is ready - #${input.orderNumber}`,
    textContent: [
      `Hello ${input.customerName},`,
      `Your ${input.merchantName} ${kind} for order #${input.orderNumber} is ready.`,
      kind === 'invoice'
        ? 'Your PDF invoice is attached.'
        : 'Your PDF receipt is attached.',
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
      preheader: `Your ${kind} for order #${escapeText(input.orderNumber)} is ready.`,
      brandWordmark: escapeText(input.merchantName),
      brandColor: color,
      eyebrow: kind.toUpperCase(),
      headline: `Your ${kind} is ready`,
      subhead: `Order #${escapeText(input.orderNumber)}`,
      greetingName: escapeText(input.customerName),
      introHtml: `<p>Your PDF ${kind} is attached.</p><p>${escapeText(disclaimer)}</p><p>${escapeText(verification)}</p>${optionalAppHtml}`,
      sectionLabel: 'Your purchase',
      deviceRowsHtml: renderReceiptDeviceRows(
        input.devices.map(escapeText),
        color
      ),
      ctaHtml: renderReceiptCta(
        escapeText(claimUrl),
        `View / download ${kind}`,
        color
      ),
      reassurance:
        'Use the email address you provided when making this purchase.',
      supportLineHtml: `Need help? ${escapeText(input.supportEmail)}`,
      footerNote: escapeText(input.merchantName),
    }),
  };
}
