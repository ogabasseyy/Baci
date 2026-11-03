import { describe, expect, it } from 'vitest';
import { formatReceiptDate } from '@/lib/receipt-pdf-formatters';
import {
  type generateReceiptBlob,
  generateReceiptPDF,
} from '@/lib/receipt-pdf-generator';

const baseMerchant = {
  business_name: 'Ogabassey',
  logo_url: null,
  email: 'hello@ogabassey.com',
  phone: '+2348011111111',
  support_email: 'support@ogabassey.com',
  support_phone: '+2348022222222',
  business_address: '12 Allen Avenue, Ikeja',
  cac_rc_number: null,
  tax_identification_number: null,
  legal_entity_name: null,
  brand_colors: {
    primary: '#111827',
    background: '#ffffff',
    accent: '#ef4444',
  },
  vat_registration_status: null,
  vat_rate: null,
  bank_code: null,
  bank_account_number: null,
};

const baseOrder = {
  order_number: 'ORD-1001',
  created_at: '2026-03-22T10:00:00.000Z',
  currency: 'NGN',
  total: 150000,
  subtotal: 145000,
  shipping_fee: 5000,
  tax_amount: 0,
  discount_amount: 0,
  amount_paid: 150000,
  balance: 0,
  payment_status: 'paid' as const,
  payment_method: 'card',
  customer_name: 'Oga Bassey',
  customer_email: 'oga@example.com',
  customer_phone: '+2348012345678',
};

function getPdfText(
  order: Parameters<typeof generateReceiptBlob>[0],
  merchant: Parameters<typeof generateReceiptBlob>[1],
  options?: Parameters<typeof generateReceiptPDF>[2]
) {
  return generateReceiptPDF(order, merchant, options)
    .output()
    .replaceAll(String.fromCharCode(0), '');
}

describe('generateReceiptPDF payment history', () => {
  it('renders the payment-history table from order transactions', () => {
    const order = {
      ...baseOrder,
      items: [
        {
          product_name: 'Device',
          quantity: 1,
          price: 150000,
        },
      ],
      transactions: [
        {
          amount: 100000,
          created_at: '2026-03-20T10:00:00Z',
          description: 'Bank transfer',
          metadata: { payment_method: 'transfer' },
        },
        {
          amount: 50000,
          created_at: '2026-03-22T10:00:00Z',
          description: null,
          metadata: null,
        },
      ],
    };
    const pdfText = getPdfText(order, baseMerchant);

    expect(pdfText).toContain('Payment Date');
    expect(pdfText).toContain('transfer');
    expect(pdfText).toContain('Payment');
    expect(pdfText).toContain(formatReceiptDate('2026-03-20T10:00:00Z'));
    expect(pdfText).toContain(formatReceiptDate('2026-03-22T10:00:00Z'));
  });
});
