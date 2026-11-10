import { describe, expect, it } from 'vitest';
import {
  generateOrderCancellationEmail,
  generateOrderCancellationText,
} from './order-cancellation';

const basePayload = {
  orderNumber: 'ORD-006',
  customerName: 'Jane Doe',
  items: [{ name: 'Gadget', quantity: 1, price: 5000 }],
  totalAmount: 5000,
  amountPaid: 5000,
  refundAmount: 5000,
  cancelledBy: 'merchant' as const,
  merchantName: 'TestShop',
  merchantUrl: 'https://testshop.usebaci.com',
  currency: 'NGN',
};

describe('Order cancellation email', () => {
  describe('registration info in footer', () => {
    it('includes TIN and RC number when provided', () => {
      const html = generateOrderCancellationEmail({
        ...basePayload,
        merchantTin: '4444444444',
        merchantRcNumber: 'RC-44444',
      });

      expect(html).toContain('TIN: 4444444444');
      expect(html).toContain('RC: RC-44444');
    });
  });

  describe('currency formatting', () => {
    it('renders NGN orders identically to the pre-multi-country baseline', () => {
      const output = [
        generateOrderCancellationEmail(basePayload),
        generateOrderCancellationText(basePayload),
      ].join('\n');

      expect(output).toContain('₦5,000');
      expect(output).not.toMatch(/₹|INR/);
    });

    it('uses the provided currency for email and text', () => {
      const payload = { ...basePayload, currency: 'INR' };
      const output = [
        generateOrderCancellationEmail(payload),
        generateOrderCancellationText(payload),
      ].join('\n');

      expect(output).toContain('₹5,000');
      expect(output).toContain('Potential refund (pending): ₹5,000');
      expect(output).not.toContain('₦');
    });
  });

  describe('HTML escaping (XSS prevention)', () => {
    it('escapes user data and rejects unsafe merchant links', () => {
      const XSS = '<script>alert(1)</script>';
      const html = generateOrderCancellationEmail({
        orderNumber: XSS,
        customerName: XSS,
        items: [{ name: XSS, quantity: 1, price: 1000 }],
        totalAmount: 1000,
        amountPaid: 1000,
        refundAmount: 1000,
        cancelledBy: 'merchant',
        cancellationReason: XSS,
        supportEmail: XSS,
        merchantName: XSS,
        merchantUrl: 'javascript:alert(1)',
        currency: 'NGN',
      });

      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).not.toContain('javascript:alert(1)');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });
});

describe('cancellation refund status wording', () => {
  it('does not promise that a queued refund has already succeeded', () => {
    const html = generateOrderCancellationEmail({
      orderNumber: 'ORD-1',
      customerName: 'Buyer',
      items: [],
      totalAmount: 100,
      amountPaid: 100,
      refundAmount: 100,
      cancelledBy: 'merchant',
      merchantName: 'Store',
      merchantUrl: 'https://example.com',
      currency: 'NGN',
    });
    // The customer_email step is independent of the refund step: the email
    // must not assert refund-workflow initiation while the refund may still
    // be failed or delivery_uncertain.
    expect(html).not.toContain('Cancellation starts the refund workflow');
    expect(html).toContain(
      'The store will review your order to confirm whether a refund'
    );
    expect(html).not.toContain('If you have already paid');
    expect(html).not.toMatch(/will (review your order and )?arrange/i);
    expect(html).not.toContain('original payment method');
    expect(html).toContain('does not confirm that the refund has been sent');
    expect(html).toContain('contact the store');
    expect(html).not.toContain('Refund Amount');
    expect(html).not.toMatch(/has been refunded|was refunded|refunded to you/i);
    expect(html).not.toContain('will be processed within 3-5 business days');
    const text = generateOrderCancellationText({
      orderNumber: 'ORD-1',
      customerName: 'Buyer',
      items: [],
      totalAmount: 100,
      amountPaid: 100,
      refundAmount: 100,
      cancelledBy: 'merchant',
      merchantName: 'Store',
      merchantUrl: 'https://example.com',
      currency: 'NGN',
    });
    expect(text).toContain('Potential refund (pending): ₦100');
    expect(text).toContain('does not confirm that the refund has been sent');
    expect(text).not.toContain('Refund Amount');
    expect(text).not.toMatch(/business days/i);
    expect(html).not.toMatch(/within \d+ business days/i);
    expect(html).not.toMatch(/will refund/i);
    expect(html).toContain('Refund Information (pending)');
    expect(html).not.toContain('#ecfdf5');
    expect(text).not.toMatch(/will refund/i);
    expect(text).not.toContain('original payment method');
    expect(text).toContain('REFUND INFORMATION (PENDING)');
  });
  it('omits the refund block when nothing is refundable', () => {
    const data = {
      orderNumber: 'ORD-0',
      customerName: 'Buyer',
      items: [],
      totalAmount: 100,
      amountPaid: 0,
      refundAmount: 0,
      cancelledBy: 'customer' as const,
      merchantName: 'Store',
      merchantUrl: 'https://example.com',
      currency: 'NGN',
    };
    const html = generateOrderCancellationEmail(data);
    const text = generateOrderCancellationText(data);
    expect(html).not.toContain('Refund Information');
    expect(html).not.toContain('Potential refund');
    expect(text).not.toContain('REFUND INFORMATION');
    expect(text).not.toContain('Potential refund');
  });
});
