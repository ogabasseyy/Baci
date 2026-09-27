import { describe, expect, it } from 'vitest';
import { renderBankDetailsHtml } from './receipt-payment-instructions';
import type { ReceiptMerchant, ReceiptOptions, ReceiptOrder } from './types';

function createReceiptOrder(
  overrides: Partial<ReceiptOrder> = {}
): ReceiptOrder {
  return {
    order_number: 'ORD-123',
    created_at: '2026-04-08T18:02:55.974Z',
    currency: 'NGN',
    total: 500000,
    subtotal: 500000,
    shipping_fee: 0,
    tax_amount: 0,
    discount_amount: 0,
    amount_paid: 0,
    balance: 500000,
    payment_status: 'unpaid',
    payment_method: null,
    customer_name: 'Akinola Ogunniran',
    customer_email: 'akin@example.com',
    customer_phone: null,
    items: [],
    ...overrides,
  };
}

function createReceiptMerchant(
  overrides: Partial<ReceiptMerchant> = {}
): ReceiptMerchant {
  return {
    business_name: 'Ogabassey',
    logo_url: null,
    email: 'merchant@example.com',
    phone: '+2348012345678',
    support_email: null,
    support_phone: null,
    business_address: null,
    cac_rc_number: null,
    tax_identification_number: null,
    legal_entity_name: null,
    vat_registration_status: null,
    vat_rate: null,
    bank_code: null,
    bank_account_number: null,
    ...overrides,
  };
}

function renderPaymentInstructions(options: ReceiptOptions): string {
  return renderBankDetailsHtml({
    order: createReceiptOrder(),
    merchant: createReceiptMerchant(),
    options,
    brandPrimary: '#111827',
    brandAccent: '#d10f1f',
    contactEmail: null,
    contactPhone: null,
    isPaid: false,
  });
}

describe('renderBankDetailsHtml', () => {
  it('renders safe HTTP payment links', () => {
    const html = renderPaymentInstructions({
      paymentLink: 'https://pay.example.com/checkout?order=ORD-123',
    });

    expect(html).toContain(
      'href="https://pay.example.com/checkout?order=ORD-123"'
    );
    expect(html).toContain('Pay Now');
  });

  it('does not render unsafe payment link schemes as hrefs', () => {
    const html = renderPaymentInstructions({
      paymentLink: 'javascript:alert(1)',
    });

    expect(html).toBe('');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('javascript:');
  });

  it('suppresses transfer instructions when no balance remains due', () => {
    const html = renderBankDetailsHtml({
      order: createReceiptOrder({
        total: 0,
        subtotal: 0,
        amount_paid: 0,
        balance: 0,
        payment_status: 'unpaid',
        virtual_account: {
          account_name: 'Ada Buyer',
          account_number: '1234567890',
          bank_name: 'Wema Bank',
        },
      }),
      merchant: createReceiptMerchant(),
      options: {},
      brandPrimary: '#111827',
      brandAccent: '#d10f1f',
      contactEmail: null,
      contactPhone: null,
      isPaid: false,
    });

    expect(html).toBe('');
    expect(html).not.toContain('Transfer here for instant order confirmation');
  });

  it('renders manual merchant bank details for invoice payments', () => {
    const html = renderBankDetailsHtml({
      order: createReceiptOrder({ currency: 'INR' }),
      merchant: createReceiptMerchant({
        business_name: 'Yodha Shopping',
        bank_name: 'HDFC Bank',
        bank_account_name: 'Yodha Collections Ltd',
        bank_account_number: 'IN-123456789012',
      }),
      options: {},
      brandPrimary: '#111827',
      brandAccent: '#d10f1f',
      contactEmail: 'support@yodha.example',
      contactPhone: '+919876543210',
      isPaid: false,
    });

    expect(html).toContain('Manual Confirmation');
    expect(html).toContain('HDFC Bank');
    expect(html).toContain('Yodha Collections Ltd');
    expect(html).toContain('IN-123456789012');
  });
});
