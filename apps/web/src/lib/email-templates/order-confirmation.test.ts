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

    it('renders bank-transfer instructions the reader can act on', () => {
      const html = generateOrderConfirmationEmail({
        ...proformaPayload,
        virtualAccount: {
          bankName: 'Wema Bank',
          accountNumber: '1234567890',
          accountName: 'OgaBassey-Test',
        },
      });

      // The tracking link cannot take payment: the reader pays by
      // transfer, so the account details must be in the email itself.
      expect(html).toContain('Complete Your Bank Transfer');
      expect(html).toContain('Wema Bank');
      expect(html).toContain('OgaBassey-Test');
      expect(html).toContain('1234567890');
      expect(html).not.toContain('pay using the invoice link');
    });

    it('routes text payment through the transfer details, not the link', () => {
      const text = generateOrderConfirmationText({
        ...proformaPayload,
        virtualAccount: {
          bankName: 'Wema Bank',
          accountNumber: '1234567890',
          accountName: 'OgaBassey-Test',
        },
      });

      expect(text).toContain('Payment Details (bank transfer)');
      expect(text).toContain('Account Number: 1234567890');
      expect(text).toContain('Complete your bank transfer');
      expect(text).not.toContain('Complete payment using your invoice link');
    });

    it('falls back to merchant contact when no account was assigned', () => {
      const html = generateOrderConfirmationEmail(proformaPayload);
      const text = generateOrderConfirmationText(proformaPayload);

      expect(html).not.toContain('Complete Your Bank Transfer');
      expect(text).not.toContain('Payment Details (bank transfer)');
      expect(text).toContain('please contact TestShop for payment details');
    });

    it('directs HTML readers to the merchant when no account was assigned', () => {
      const html = generateOrderConfirmationEmail(proformaPayload);

      // Without a DVA the payment-details block is omitted: the HTML
      // intro must not promise details "in this email" but match the
      // text fallback so the reader still has a payable path.
      expect(html).not.toContain('payment details in this email');
      expect(html).toContain('contact TestShop for payment details');
    });

    it('charges only the outstanding balance after partial credit', () => {
      const payload = {
        ...proformaPayload,
        total: 11500,
        amountDue: 1500,
        virtualAccount: {
          bankName: 'Wema Bank',
          accountNumber: '1234567890',
          accountName: 'OgaBassey-Test',
        },
      };
      const html = generateOrderConfirmationEmail(payload);
      const text = generateOrderConfirmationText(payload);

      // 10000 of credit already applied: instructing the full 11500
      // would overcharge the customer.
      expect(html).toContain('Transfer <strong>₦1,500.00</strong>');
      expect(html).not.toContain('Transfer <strong>₦11,500.00</strong>');
      expect(text).toContain('Complete your bank transfer of ₦1,500.00');
      expect(text).not.toContain(
        'Complete your bank transfer of ₦11,500.00'
      );
    });

    it('falls back to merchant contact for foreign-currency quotes', () => {
      // Paystack DVAs settle in NGN only: a USD quote must not print a
      // naira account beside a dollar amount, even if a stale account
      // object is passed.
      const payload = {
        ...proformaPayload,
        currency: 'USD',
        virtualAccount: {
          bankName: 'Wema Bank',
          accountNumber: '1234567890',
          accountName: 'OgaBassey-Test',
        },
      };
      const html = generateOrderConfirmationEmail(payload);
      const text = generateOrderConfirmationText(payload);

      expect(html).not.toContain('Complete Your Bank Transfer');
      expect(html).not.toContain('1234567890');
      expect(html).toContain('contact TestShop for payment details');
      expect(text).not.toContain('Payment Details (bank transfer)');
      expect(text).not.toContain('Account Number: 1234567890');
      expect(text).toContain('please contact TestShop for payment details');
    });

    it('omits transfer instructions when nothing is due', () => {
      // A 100% discount leaves amountDue at 0: instructing a ₦0.00
      // transfer (which can never confirm the order) is an impossible
      // next step, so the quote states that no payment is due instead.
      const payload = {
        ...proformaPayload,
        total: 11500,
        amountDue: 0,
        virtualAccount: {
          bankName: 'Wema Bank',
          accountNumber: '1234567890',
          accountName: 'OgaBassey-Test',
        },
      };
      const html = generateOrderConfirmationEmail(payload);
      const text = generateOrderConfirmationText(payload);

      expect(html).not.toContain('Complete Your Bank Transfer');
      expect(html).not.toContain('1234567890');
      expect(html).toContain('No payment is due on this quote');
      expect(text).not.toContain('Payment Details (bank transfer)');
      expect(text).not.toContain('Complete your bank transfer');
      expect(text).toContain('No payment is due on this quote');
    });

    it('renders payment requests with request semantics and transfer instructions', () => {
      // Pay for Me keeps its distinct document kind (never proforma) while
      // sharing the transfer-instruction mechanics: the requester forwards
      // these details to their payer.
      const payload = {
        ...proformaPayload,
        documentKind: 'payment_request' as const,
        virtualAccount: {
          bankName: 'Wema Bank',
          accountNumber: '1234567890',
          accountName: 'OgaBassey-Test',
        },
      };
      const html = generateOrderConfirmationEmail(payload);
      const text = generateOrderConfirmationText(payload);

      expect(html).toContain('Payment Request #ORD-001');
      expect(html).toContain('Share the transfer details with your payer');
      expect(html).toContain('Complete Your Bank Transfer');
      expect(html).toContain('1234567890');
      expect(html).toContain('View Payment Request');
      expect(html).not.toContain('Proforma Invoice');
      expect(html).not.toContain('procurement team');
      expect(text).toContain('Payment Request');
      expect(text).toContain('Share the transfer details with your payer');
      expect(text).toContain('Payment Details (bank transfer)');
      expect(text).toContain('Account Number: 1234567890');
      expect(text).not.toContain('Proforma Invoice');
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
