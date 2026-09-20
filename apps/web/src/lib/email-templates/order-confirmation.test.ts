import { describe, expect, it } from 'vitest';
import {
  generateOrderConfirmationEmail,
  generateOrderConfirmationText,
} from './order-confirmation';

const baseOrderData = {
  orderNumber: 'ORD-001',
  customerName: 'John Doe',
  items: [{ name: 'Widget', quantity: 2, price: 5000 }],
  subtotal: 10000,
  shippingFee: 1500,
  total: 11500,
  shippingAddress: {
    address: '123 Test St',
    city: 'Lagos',
    state: 'Lagos',
    phone: '+2348012345678',
  },
  merchantName: 'TestShop',
  merchantUrl: 'https://testshop.usebaci.com',
};

describe('Order confirmation email', () => {
  describe('registration info in footer', () => {
    it('includes TIN and RC number when both are provided', () => {
      const html = generateOrderConfirmationEmail({
        ...baseOrderData,
        merchantTin: '1234567890',
        merchantRcNumber: 'RC-12345',
      });

      expect(html).toContain('TIN: 1234567890');
      expect(html).toContain('RC: RC-12345');
    });

    it('omits TIN and RC when not provided', () => {
      const html = generateOrderConfirmationEmail(baseOrderData);

      expect(html).not.toContain('TIN:');
      expect(html).not.toContain('RC:');
    });

    it('shows only TIN when RC is not provided', () => {
      const html = generateOrderConfirmationEmail({
        ...baseOrderData,
        merchantTin: '1234567890',
      });

      expect(html).toContain('TIN: 1234567890');
      expect(html).not.toContain('RC:');
    });

    it('shows only RC when TIN is not provided', () => {
      const html = generateOrderConfirmationEmail({
        ...baseOrderData,
        merchantRcNumber: 'RC-99999',
      });

      expect(html).toContain('RC: RC-99999');
      expect(html).not.toContain('TIN:');
    });
  });

  describe('content', () => {
    it('returns valid HTML with merchant name and order number', () => {
      const html = generateOrderConfirmationEmail(baseOrderData);

      expect(html).toContain('TestShop');
      expect(html).toContain('ORD-001');
      expect(html).toContain('John Doe');
      expect(html).toContain('Widget');
    });

    it('includes order total and shipping fee', () => {
      const html = generateOrderConfirmationEmail(baseOrderData);

      expect(html).toContain('11,500');
      expect(html).toContain('1,500');
    });

    it('returns plain text with order details', () => {
      const text = generateOrderConfirmationText(baseOrderData);

      expect(text).toContain('ORD-001');
      expect(text).toContain('John Doe');
      expect(text).toContain('Widget');
      expect(text).toContain('11,500');
    });

    it('uses quotation semantics for proforma documents', () => {
      const payload = { ...baseOrderData, documentKind: 'proforma' as const };
      const html = generateOrderConfirmationEmail(payload);
      const text = generateOrderConfirmationText(payload);

      expect(html).toContain('Proforma Invoice #ORD-001');
      expect(html).not.toContain('Order #ORD-001 Confirmed');
      expect(html).toContain('no payment taken yet');
      expect(html).toContain('will be processed once payment is received');
      expect(html).toContain('View Proforma Invoice');
      expect(text).toContain('Proforma Invoice');
      expect(text).not.toContain('Order Confirmed!');
      expect(text).toContain('a quotation, not a confirmed order');
      expect(text).not.toContain('will be shipped soon');
    });

    it('keeps confirmation semantics by default', () => {
      const html = generateOrderConfirmationEmail(baseOrderData);
      const text = generateOrderConfirmationText(baseOrderData);

      expect(html).toContain('Order #ORD-001 Confirmed');
      expect(html).not.toContain('Proforma Invoice');
      expect(text).toContain('Order Confirmed!');
      expect(text).toContain('will be shipped soon');
    });
  });

  describe('currency formatting', () => {
    it('defaults to NGN when no currency is provided', () => {
      const output = [
        generateOrderConfirmationEmail(baseOrderData),
        generateOrderConfirmationText(baseOrderData),
      ].join('\n');

      expect(output).toContain('₦11,500');
      expect(output).not.toMatch(/₹|INR/);
    });

    it('uses the provided currency for email and text', () => {
      const payload = { ...baseOrderData, currency: 'INR' };
      const html = generateOrderConfirmationEmail(payload);
      const text = generateOrderConfirmationText(payload);
      const output = `${html}\n${text}`;

      expect(output).toContain('₹5,000');
      expect(output).toContain('₹10,000');
      expect(output).toContain('₹1,500');
      expect(output).toContain('₹11,500');
      expect(text).toContain('Total: ₹11,500');
      expect(output).not.toContain('₦');
    });

    it('preserves decimal amounts for currencies with minor units', () => {
      const payload = {
        ...baseOrderData,
        currency: 'USD',
        items: [{ name: 'Widget', quantity: 1, price: 1234.56 }],
        subtotal: 1234.56,
        shippingFee: 10.25,
        total: 1244.81,
      };
      const output = [
        generateOrderConfirmationEmail(payload),
        generateOrderConfirmationText(payload),
      ].join('\n');

      expect(output).toContain('$1,234.56');
      expect(output).toContain('$1,244.81');
      expect(output).not.toContain('$1,235');
    });
  });

  describe('HTML escaping (XSS prevention)', () => {
    it('escapes user data and rejects unsafe merchant links', () => {
      const XSS = '<script>alert(1)</script>';
      const html = generateOrderConfirmationEmail({
        ...baseOrderData,
        customerName: XSS,
        merchantName: XSS,
        items: [{ name: XSS, quantity: 1, price: 1000 }],
        shippingAddress: { address: XSS, city: XSS, state: XSS, phone: XSS },
        merchantUrl: 'javascript:alert(1)',
      });

      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).not.toContain('javascript:alert(1)');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });

  describe('proforma CTA destination', () => {
    const proformaPayload = {
      ...baseOrderData,
      documentKind: 'proforma' as const,
      paymentLink: 'https://testshop.usebaci.com/track-order?token=track-123',
    };

    it('points the View Proforma Invoice anchor at the order payment link', () => {
      const html = generateOrderConfirmationEmail(proformaPayload);

      expect(html).toContain('View Proforma Invoice');
      expect(html).toContain(
        'href="https://testshop.usebaci.com/track-order?token=track-123"'
      );
    });

    it('includes the payment link in the plain-text next steps', () => {
      const text = generateOrderConfirmationText(proformaPayload);

      expect(text).toContain(
        'https://testshop.usebaci.com/track-order?token=track-123'
      );
    });

    it('keeps the confirmation CTA on the storefront homepage', () => {
      const html = generateOrderConfirmationEmail({
        ...baseOrderData,
        paymentLink: 'https://testshop.usebaci.com/track-order?token=track-123',
      });

      expect(html).toContain('View Order');
      expect(html).toContain('href="https://testshop.usebaci.com/"');
      expect(html).not.toContain('track-order?token=track-123');
    });
  });
});
