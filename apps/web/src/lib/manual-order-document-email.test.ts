// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildManualOrderDocumentEmail } from './manual-order-document-email';

const input = {
  merchantName: 'Ogabassey',
  customerName: 'Ada & Sons',
  customerEmail: 'ada@example.com',
  orderNumber: 'ORD-42',
  documentKind: 'receipt' as const,
  claimUrl: 'https://ogabassey.com/receipts/claim/abc',
  devices: ['Pixel 10 Pro XL'],
  brandColor: '#d62027',
  supportEmail: 'support@ogabassey.com',
  appLinks: {
    appStoreUrl: 'https://apps.apple.com/app/id6472735367',
    playStoreUrl:
      'https://play.google.com/store/apps/details?id=com.ogabassey.store',
  },
};

describe('manual order document email', () => {
  it('offers website access and an attached receipt without requiring the app', () => {
    const result = buildManualOrderDocumentEmail(input);
    expect(result.subject).toBe('Your receipt is ready - #ORD-42');
    expect(result.htmlContent).toContain(
      'href="https://ogabassey.com/receipts/claim/abc"'
    );
    expect(result.textContent).toMatch(/PDF receipt is attached/i);
    expect(result.textContent).toMatch(/verify.*ada@example.com/i);
    expect(result.textContent).toMatch(/optional/i);
    expect(result.htmlContent).toContain('Ada &amp; Sons');
  });

  it('calls an unpaid document an invoice, not proof of payment', () => {
    const result = buildManualOrderDocumentEmail({
      ...input,
      documentKind: 'invoice',
    });
    expect(result.subject).toBe('Your invoice is ready - #ORD-42');
    expect(result.textContent).toMatch(/not.*proof of payment/i);
    expect(result.textContent).not.toMatch(/PDF receipt is attached/i);
  });

  it('strips line breaks from staff-entered order numbers in the subject', () => {
    const result = buildManualOrderDocumentEmail({
      ...input,
      orderNumber: 'ORD-42\r\nBcc: attacker@example.com',
    });
    expect(result.subject).toBe(
      'Your receipt is ready - #ORD-42Bcc: attacker@example.com'
    );
    expect(result.subject).not.toMatch(/[\r\n]/);
    expect(result.textContent).not.toMatch(/[\r\n]Bcc:/);
  });

  it('does not advertise another merchant’s app or accept unsafe URLs/colors', () => {
    const result = buildManualOrderDocumentEmail({
      ...input,
      appLinks: null,
      claimUrl: 'javascript:alert(1)',
      brandColor: 'red; background:url(evil)',
      devices: ['<script>bad</script>'],
    });
    expect(result.htmlContent).not.toContain('href="javascript:');
    expect(result.htmlContent).not.toContain('background:url(evil)');
    expect(result.htmlContent).not.toContain('<script>bad</script>');
    expect(result.textContent).not.toContain('apps.apple.com');
  });
});
