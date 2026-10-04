import { describe, expect, it } from 'vitest';
import { buildStorefrontAccountDocumentBundle } from '@/lib/storefront-account-document-bundle';

describe('buildStorefrontAccountDocumentBundle', () => {
  it('itemizes assurance without dropping shipping/discount from the document totals', () => {
    const result = buildStorefrontAccountDocumentBundle({
      merchant: {
        business_name: 'Ogabassey',
        logo_url: null,
        email: null,
        phone: null,
        support_email: null,
        support_phone: null,
        business_address: null,
        cac_rc_number: null,
        tax_identification_number: null,
        legal_entity_name: null,
        brand_colors: null,
        vat_registration_status: 'unregistered',
        vat_rate: 0,
        bank_code: null,
        bank_account_number: null,
        bank_name: null,
        bank_account_name: null,
        social_media: null,
        pages: null,
        registered_address: null,
      },
      customer: {
        first_name: 'Oga',
        last_name: 'Bassey',
        email: 'customer@example.com',
        phone: null,
      },
      order: {
        id: 'order-assurance',
        order_number: 'ORD-ASR',
        created_at: '2026-03-22T10:00:00.000Z',
        updated_at: null,
        payment_status: 'paid',
        shipping_status: 'shipped',
        currency: 'NGN',
        // subtotal includes the rolled-in 3,000 assurance premium (103,000),
        // and the stored pre-tax total already adds shipping (5,000) and
        // subtracts discount (1,000): 103,000 + 5,000 - 1,000 = 107,000.
        total: 107000,
        subtotal: 103000,
        shipping_fee: 5000,
        tax_amount: 0,
        discount_amount: 1000,
        amount_paid: 107000,
        shipping_address: 'Pickup',
        customer_name: null,
        customer_email: null,
        customer_phone: null,
        payment_method: 'card',
        is_credit_order: false,
        tracking_number: null,
        shipping_provider: null,
        notes: null,
        invoice_type_code: '380',
        invoice_issue_date: null,
        tax_point_date: null,
        payment_due_date: null,
        buyer_reference: null,
        purchase_order_reference: null,
        tax_exclusive_amount: 107000,
        tax_inclusive_amount: 107000,
        invoice_note: null,
        firs_irn: null,
        firs_csid: null,
        firs_qr_code: null,
        payment_terms: null,
      },
      itemRows: [
        {
          id: 'item-1',
          product_id: 'prod-1',
          variant_id: null,
          variant_name: null,
          name: 'iPhone 16',
          quantity: 1,
          price: 100000,
          vat_category_code: 'O',
          vat_rate: 0,
          vat_amount: 0,
          assurance_fee: 3000,
        },
      ],
      transactions: [],
      paymentAccount: null,
      taxRows: [],
      paymentStatus: 'paid',
      shippingStatus: 'shipped',
      currentDocumentKind: 'invoice',
    });

    // The assurance premium is itemized as its own zero-rated line...
    const assuranceLine = result.invoiceData.items.find(
      (item) => item.name === 'Ogabassey Assurance'
    );
    expect(assuranceLine?.line_extension_amount).toBe(3000);
    expect(assuranceLine?.vat_category_code).toBe('O');

    // ...but the BT-109/BT-112 totals stay the stored values, preserving the
    // shipping charge and discount allowance (regression: must NOT collapse to
    // the 103,000 line-only sum).
    expect(result.invoiceData.tax_exclusive_amount).toBe(107000);
    expect(result.invoiceData.tax_inclusive_amount).toBe(107000);
    expect(result.invoiceData.shipping_fee).toBe(5000);
    expect(result.invoiceData.discount_amount).toBe(1000);
  });

  it('includes the assurance premium in totals when stored tax totals are product-only (storefront RPC)', () => {
    const result = buildStorefrontAccountDocumentBundle({
      merchant: {
        business_name: 'Ogabassey',
        logo_url: null,
        email: null,
        phone: null,
        support_email: null,
        support_phone: null,
        business_address: null,
        cac_rc_number: null,
        tax_identification_number: null,
        legal_entity_name: null,
        brand_colors: null,
        vat_registration_status: 'unregistered',
        vat_rate: 0,
        bank_code: null,
        bank_account_number: null,
        bank_name: null,
        bank_account_name: null,
        social_media: null,
        pages: null,
        registered_address: null,
      },
      customer: {
        first_name: 'Oga',
        last_name: 'Bassey',
        email: 'customer@example.com',
        phone: null,
      },
      order: {
        id: 'order-storefront-assurance',
        order_number: 'ORD-SF-ASR',
        created_at: '2026-03-22T10:00:00.000Z',
        updated_at: null,
        payment_status: 'paid',
        shipping_status: 'shipped',
        currency: 'NGN',
        // Storefront RPC: subtotal includes the 3,000 assurance premium
        // (103,000), but the trigger stores tax_exclusive/inclusive from
        // SUM(line_extension_amount) = product only (100,000), excluding it.
        total: 103000,
        subtotal: 103000,
        shipping_fee: 0,
        tax_amount: 0,
        discount_amount: 0,
        amount_paid: 103000,
        shipping_address: 'Pickup',
        customer_name: null,
        customer_email: null,
        customer_phone: null,
        payment_method: 'card',
        is_credit_order: false,
        tracking_number: null,
        shipping_provider: null,
        notes: null,
        invoice_type_code: '380',
        invoice_issue_date: null,
        tax_point_date: null,
        payment_due_date: null,
        buyer_reference: null,
        purchase_order_reference: null,
        tax_exclusive_amount: 100000,
        tax_inclusive_amount: 100000,
        invoice_note: null,
        firs_irn: null,
        firs_csid: null,
        firs_qr_code: null,
        payment_terms: null,
      },
      itemRows: [
        {
          id: 'item-1',
          product_id: 'prod-1',
          variant_id: null,
          variant_name: null,
          name: 'iPhone 16',
          quantity: 1,
          price: 100000,
          vat_category_code: 'O',
          vat_rate: 0,
          vat_amount: 0,
          assurance_fee: 3000,
        },
      ],
      transactions: [],
      paymentAccount: null,
      taxRows: [],
      paymentStatus: 'paid',
      shippingStatus: 'shipped',
      currentDocumentKind: 'invoice',
    });

    // BT-109/BT-112 must include the premium (103,000), not the stored
    // product-only 100,000 — otherwise the lines exceed the document total.
    expect(result.invoiceData.tax_exclusive_amount).toBe(103000);
    expect(result.invoiceData.tax_inclusive_amount).toBe(103000);
  });
});
