import { describe, expect, it } from 'vitest';
import {
  buildReceiptMerchant,
  buildReceiptOrder,
} from '@/lib/storefront-account-document-receipt';

describe('storefront account receipt builders', () => {
  it('builds receipt merchant metadata from the merchant row', () => {
    const result = buildReceiptMerchant(
      {
        business_name: 'Ogabassey',
        logo_url: 'https://example.com/logo.png',
        email: 'merchant@example.com',
        phone: '08000000000',
        support_email: 'support@example.com',
        support_phone: '08011111111',
        business_address: '12 Allen Avenue',
        cac_rc_number: 'RC123',
        tax_identification_number: 'TIN123',
        legal_entity_name: 'Ogabassey Ltd',
        brand_colors: { primary: '#000000' },
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        bank_code: '999',
        bank_account_number: '1234567890',
        bank_name: 'Baci Bank',
        bank_account_name: 'Ogabassey Ltd',
        social_media: { instagram: '@ogabassey' },
        pages: { about: true },
        registered_address: {
          street: '99 Registered Road',
          city: 'Ikeja',
        },
      },
      'NGN'
    );

    expect(result.business_name).toBe('Ogabassey');
    expect(result.brand_colors).toEqual({ primary: '#000000' });
    expect(result.bank_account_number).toBe('1234567890');
    expect(result.registered_address).toEqual({
      street: '99 Registered Road',
      city: 'Ikeja',
    });
  });

  it('falls back to an empty merchant email when the source value is null', () => {
    const result = buildReceiptMerchant(
      {
        business_name: 'Ogabassey',
        logo_url: 'https://example.com/logo.png',
        email: null,
        phone: '08000000000',
        support_email: 'support@example.com',
        support_phone: '08011111111',
        business_address: '12 Allen Avenue',
        cac_rc_number: 'RC123',
        tax_identification_number: 'TIN123',
        legal_entity_name: 'Ogabassey Ltd',
        brand_colors: { primary: '#000000' },
        vat_registration_status: 'registered',
        vat_rate: 7.5,
        bank_code: '999',
        bank_account_number: '1234567890',
        bank_name: 'Baci Bank',
        bank_account_name: 'Ogabassey Ltd',
        social_media: { instagram: '@ogabassey' },
        pages: { about: true },
        registered_address: null,
      },
      'NGN'
    );

    expect(result.email).toBe('');
    expect(result.business_name).toBe('Ogabassey');
    expect(result.bank_account_number).toBe('1234567890');
  });

  it('strips merchant bank details for foreign-currency documents', () => {
    const result = buildReceiptMerchant(
      {
        business_name: 'Ogabassey',
        logo_url: null,
        email: 'merchant@example.com',
        phone: null,
        support_email: null,
        support_phone: null,
        business_address: null,
        cac_rc_number: null,
        tax_identification_number: null,
        legal_entity_name: null,
        brand_colors: null,
        vat_registration_status: null,
        vat_rate: null,
        bank_code: '999',
        bank_account_number: '1234567890',
        bank_name: 'Baci Bank',
        bank_account_name: 'Ogabassey Ltd',
        social_media: null,
        pages: null,
        registered_address: null,
      },
      'USD'
    );

    // Downloads and previews must not print this naira account beside a
    // dollar amount under Payment Instructions.
    expect(result.bank_code).toBeNull();
    expect(result.bank_account_number).toBeNull();
    expect(result.bank_name).toBeNull();
    expect(result.bank_account_name).toBeNull();
    expect(result.business_name).toBe('Ogabassey');
  });

  it('builds receipt order details from normalized document data', () => {
    const result = buildReceiptOrder({
      order: {
        id: 'order-1',
        order_number: 'ORD-1001',
        created_at: '2026-03-22T10:00:00.000Z',
        updated_at: null,
        payment_status: 'paid',
        shipping_status: 'shipped',
        currency: 'NGN',
        total: 110000,
        subtotal: 100000,
        shipping_fee: 5000,
        tax_amount: 5000,
        discount_amount: 0,
        amount_paid: 110000,
        shipping_address: null,
        customer_name: null,
        customer_email: null,
        customer_phone: null,
        payment_method: 'card',
        is_credit_order: false,
        tracking_number: null,
        shipping_provider: null,
        notes: null,
        invoice_type_code: null,
        invoice_issue_date: null,
        tax_point_date: null,
        payment_due_date: null,
        buyer_reference: null,
        purchase_order_reference: null,
        tax_exclusive_amount: null,
        tax_inclusive_amount: null,
        invoice_note: null,
        firs_irn: null,
        firs_csid: null,
        firs_qr_code: null,
        payment_terms: null,
      },
      orderItems: [
        {
          id: 'item-1',
          product_id: 'prod-1',
          name: 'iPhone 16',
          product_name: 'iPhone 16',
          condition: 'open_box',
          variant_name: '512GB',
          quantity: 1,
          price: 100000,
        },
      ],
      transactions: [
        {
          id: 'tx-1',
          amount: '110000',
          created_at: '2026-03-22T10:10:00.000Z',
          description: 'Card payment',
          metadata: { payment_method: 'card' },
        },
      ],
      paymentAccount: {
        account_number: '1234567890',
        bank_name: 'Baci Bank',
        account_name: 'Ogabassey Ltd',
      },
      paymentStatus: 'paid',
      shippingAddress: {
        address_line1: '12 Allen Avenue',
        city: 'Lagos',
        state: 'Lagos',
        postal_code: '100001',
        country: 'NG',
      },
      currency: 'NGN',
      total: 110000,
      subtotal: 100000,
      shippingFee: 5000,
      taxAmount: 5000,
      discountAmount: 0,
      amountPaid: 110000,
      balance: 0,
      customerName: 'Oga Bassey',
      customerEmail: 'customer@example.com',
      customerPhone: '08022222222',
    });

    expect(result.customer_name).toBe('Oga Bassey');
    expect(result.items).toMatchObject([
      {
        line_id: 1,
        product_id: 'prod-1',
        product_name: 'iPhone 16',
        condition: 'open_box',
        variant_name: '512GB',
        quantity: 1,
        price: 100000,
      },
    ]);
    expect(result.transactions).toEqual([
      {
        amount: 110000,
        created_at: '2026-03-22T10:10:00.000Z',
        description: 'Card payment',
        metadata: { payment_method: 'card' },
      },
    ]);
    expect(result.virtual_account?.account_number).toBe('1234567890');
  });

  it('falls back to a null virtual account when no payment account exists', () => {
    const result = buildReceiptOrder({
      order: {
        id: 'order-1',
        order_number: 'ORD-1001',
        created_at: '2026-03-22T10:00:00.000Z',
        updated_at: null,
        payment_status: 'paid',
        shipping_status: 'shipped',
        currency: 'NGN',
        total: 110000,
        subtotal: 100000,
        shipping_fee: 5000,
        tax_amount: 5000,
        discount_amount: 0,
        amount_paid: 110000,
        shipping_address: null,
        customer_name: null,
        customer_email: null,
        customer_phone: null,
        payment_method: 'card',
        is_credit_order: false,
        tracking_number: null,
        shipping_provider: null,
        notes: null,
        invoice_type_code: null,
        invoice_issue_date: null,
        tax_point_date: null,
        payment_due_date: null,
        buyer_reference: null,
        purchase_order_reference: null,
        tax_exclusive_amount: null,
        tax_inclusive_amount: null,
        invoice_note: null,
        firs_irn: null,
        firs_csid: null,
        firs_qr_code: null,
        payment_terms: null,
      },
      orderItems: [
        {
          id: 'item-1',
          product_id: 'prod-1',
          name: 'iPhone 16',
          product_name: 'iPhone 16',
          quantity: 1,
          price: 100000,
        },
      ],
      transactions: [
        {
          id: 'tx-1',
          amount: '110000',
          created_at: '2026-03-22T10:10:00.000Z',
          description: 'Card payment',
          metadata: { payment_method: 'card' },
        },
      ],
      paymentAccount: null,
      paymentStatus: 'paid',
      shippingAddress: {
        address_line1: '12 Allen Avenue',
        city: 'Lagos',
        state: 'Lagos',
        postal_code: '100001',
        country: 'NG',
      },
      currency: 'NGN',
      total: 110000,
      subtotal: 100000,
      shippingFee: 5000,
      taxAmount: 5000,
      discountAmount: 0,
      amountPaid: 110000,
      balance: 0,
      customerName: 'Oga Bassey',
      customerEmail: 'customer@example.com',
      customerPhone: '08022222222',
    });

    expect(result.virtual_account).toBeNull();
    expect(result.customer_name).toBe('Oga Bassey');
    expect(result.items).toHaveLength(1);
    expect(result.transactions).toHaveLength(1);
  });

  it('strips a persisted virtual account for foreign-currency documents', () => {
    const result = buildReceiptOrder({
      order: {
        id: 'order-fx-1',
        order_number: 'ORD-FX-1',
        created_at: '2026-03-22T10:00:00.000Z',
        updated_at: null,
        payment_status: 'unpaid',
        shipping_status: 'pending',
        currency: 'USD',
        total: 500,
        subtotal: 500,
        shipping_fee: 0,
        tax_amount: 0,
        discount_amount: 0,
        amount_paid: 0,
        shipping_address: null,
        customer_name: null,
        customer_email: null,
        customer_phone: null,
        payment_method: 'paystack',
        is_credit_order: false,
        tracking_number: null,
        shipping_provider: null,
        notes: null,
        invoice_type_code: null,
        invoice_issue_date: null,
        tax_point_date: null,
        payment_due_date: null,
        buyer_reference: null,
        purchase_order_reference: null,
        tax_exclusive_amount: null,
        tax_inclusive_amount: null,
        invoice_note: null,
        firs_irn: null,
        firs_csid: null,
        firs_qr_code: null,
        payment_terms: null,
      },
      orderItems: [],
      transactions: [],
      paymentAccount: {
        account_number: '1234567890',
        bank_name: 'Baci Bank',
        account_name: 'Ogabassey Ltd',
      },
      paymentStatus: 'unpaid',
      shippingAddress: null,
      currency: 'USD',
      total: 500,
      subtotal: 500,
      shippingFee: 0,
      taxAmount: 0,
      discountAmount: 0,
      amountPaid: 0,
      balance: 500,
      customerName: 'Ada Buyer',
      customerEmail: 'ada@example.com',
      customerPhone: null,
    });

    // The persisted Paystack DVA is a naira account: printing it beside a
    // dollar-denominated balance risks a rejected or mis-converted
    // transfer, so the order-level account is stripped like the merchant
    // fallback.
    expect(result.virtual_account).toBeNull();
  });
});
