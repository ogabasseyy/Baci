import { describe, expect, it } from 'vitest';
import {
  generatePaymentReminderEmail,
  generatePaymentReminderText,
} from './payment-reminder';

const basePayload = {
  orderNumber: 'ORD-002',
  customerName: 'Jane Doe',
  items: [{ name: 'Gadget', quantity: 1, price: 20000 }],
  totalAmount: 20000,
  amountPaid: 5000,
  balanceDue: 15000,
  paymentLink: 'https://pay.test/link',
  merchantName: 'TestShop',
  merchantUrl: 'https://testshop.usebaci.com',
  currency: 'NGN',
};

describe('Payment reminder email', () => {
  describe('registration info in footer', () => {
    it('includes TIN and RC number when provided', () => {
      const html = generatePaymentReminderEmail({
        ...basePayload,
        amountPaid: 0,
        balanceDue: 20000,
        merchantTin: '9876543210',
        merchantRcNumber: 'RC-54321',
      });

      expect(html).toContain('TIN: 9876543210');
      expect(html).toContain('RC: RC-54321');
    });
  });

  describe('currency formatting', () => {
    it('renders NGN orders identically to the pre-multi-country baseline', () => {
      const output = [
        generatePaymentReminderEmail(basePayload),
        generatePaymentReminderText(basePayload),
      ].join('\n');

      expect(output).toContain('₦20,000');
      expect(output).toContain('₦15,000');
      expect(output).not.toMatch(/₹|INR/);
    });

    it('uses the provided currency for email and text', () => {
      const payload = { ...basePayload, currency: 'INR' };
      const output = [
        generatePaymentReminderEmail(payload),
        generatePaymentReminderText(payload),
      ].join('\n');

      expect(output).toContain('₹20,000');
      expect(output).toContain('₹15,000');
      expect(output).not.toContain('₦');
    });
  });

  describe('HTML escaping (XSS prevention)', () => {
    it('escapes user data including the bank-transfer block', () => {
      const XSS = '<script>alert(1)</script>';
      const html = generatePaymentReminderEmail({
        orderNumber: XSS,
        customerName: XSS,
        items: [{ name: XSS, quantity: 1, price: 1000 }],
        totalAmount: 1000,
        amountPaid: 0,
        balanceDue: 1000,
        paymentLink: 'javascript:alert(1)',
        merchantName: XSS,
        merchantUrl: 'javascript:alert(1)',
        supportEmail: XSS,
        currency: 'NGN',
        // Bank-transfer block: only renders when virtualAccount is present.
        virtualAccount: {
          bankName: XSS,
          accountNumber: XSS,
          accountName: XSS,
        },
      });

      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).not.toContain('javascript:alert(1)');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
  });

  describe('payable CTA', () => {
    const accountPayload = {
      ...basePayload,
      virtualAccount: {
        bankName: 'Wema Bank',
        accountNumber: '1234567890',
        accountName: 'OgaBassey-Test',
      },
    };

    it('labels the tracking link honestly and makes transfer instructions explicit', () => {
      const html = generatePaymentReminderEmail(accountPayload);
      const text = generatePaymentReminderText(accountPayload);

      // The link opens order tracking (status only): it must not promise
      // one-click payment, and the actual payment path — the transfer —
      // must name the balance due.
      expect(html).not.toContain('Complete Payment');
      expect(html).not.toContain('just one click');
      expect(html).toContain('Track Your Order');
      expect(html).toContain('https://pay.test/link');
      expect(html).toContain('Transfer <strong>₦15,000.00</strong>');
      expect(html).toContain('1234567890');
      expect(text).not.toContain('Complete your payment here');
      expect(text).toContain('Track your order here: https://pay.test/link');
      expect(text).toContain(
        'Complete your bank transfer of ₦15,000.00'
      );
      expect(text).toContain('Account Number: 1234567890');
    });

    it('directs readers without an assigned account to the merchant', () => {
      const html = generatePaymentReminderEmail({
        ...basePayload,
        supportEmail: 'help@testshop.com',
      });
      const text = generatePaymentReminderText(basePayload);

      expect(html).not.toContain('Complete Payment');
      expect(html).toContain('Track Your Order');
      expect(html).toContain('How to pay');
      expect(html).toContain('mailto:help@testshop.com');
      expect(html).toContain('arrange payment of ₦15,000.00');
      expect(text).toContain('How to pay:');
      expect(text).toContain(
        'Please contact TestShop to arrange payment'
      );
    });

    it('suppresses the naira account block for foreign-currency orders', () => {
      const html = generatePaymentReminderEmail({
        ...accountPayload,
        currency: 'USD',
      });
      const text = generatePaymentReminderText({
        ...accountPayload,
        currency: 'USD',
      });

      expect(html).not.toContain('1234567890');
      expect(html).toContain('How to pay');
      expect(text).not.toContain('Account Number: 1234567890');
      expect(text).toContain('How to pay:');
    });
  });

  describe('mailto fallback', () => {
    it('derives a clean host (no protocol/path) when supportEmail is absent', () => {
      const html = generatePaymentReminderEmail({
        orderNumber: 'ORD-X',
        customerName: 'Jane Doe',
        items: [{ name: 'Gadget', quantity: 1, price: 1000 }],
        totalAmount: 1000,
        amountPaid: 0,
        balanceDue: 1000,
        paymentLink: 'https://pay.test/link',
        merchantName: 'TestShop',
        merchantUrl: 'http://shop.example.com/store?ref=1',
        currency: 'NGN',
      });

      expect(html).toContain('mailto:support@shop.example.com"');
      expect(html).not.toContain('support@http');
      expect(html).not.toContain('shop.example.com/store');
    });
  });
});
