import { describe, expect, it } from 'vitest';
import { buildStorefrontAccountDocumentBundle } from '@/lib/storefront-account-document-bundle';

describe('buildStorefrontAccountDocumentBundle', () => {
  it('reconciles tax subtotals to BT-109 (incl. shipping/discount) for storefront assurance orders', () => {
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
        id: 'order-sf-charges',
        order_number: 'ORD-SF-CHG',
        created_at: '2026-03-22T10:00:00.000Z',
        updated_at: null,
        payment_status: 'paid',
        shipping_status: 'shipped',
        currency: 'NGN',
        // subtotal 103,000 (incl. 3,000 premium) + 5,000 shipping - 1,000
        // discount = 107,000 = BT-109. Stored tax totals are product-only.
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

    expect(result.invoiceData.tax_exclusive_amount).toBe(107000);
    // The tax subtotals must sum to BT-109 (107,000), not the product+assurance
    // line sum (103,000) — otherwise the UBL tax breakdown is short by shipping
    // minus discount.
    const taxableSum = result.invoiceData.tax_subtotals.reduce(
      (sum, st) => sum + st.taxable_amount,
      0
    );
    expect(taxableSum).toBe(107000);
  });

  it('falls back to invoice mode and zero-safe numeric coercion', () => {
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
        vat_registration_status: null,
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
        first_name: null,
        last_name: null,
        email: null,
        phone: null,
      },
      order: {
        id: 'order-2',
        order_number: 'ORD-1002',
        created_at: '2026-03-22T10:00:00.000Z',
        updated_at: null,
        payment_status: null,
        shipping_status: null,
        currency: null,
        total: '0',
        subtotal: '0',
        shipping_fee: null,
        tax_amount: null,
        discount_amount: null,
        amount_paid: null,
        shipping_address: 'Pickup',
        customer_name: '',
        customer_email: '',
        customer_phone: '',
        payment_method: null,
        is_credit_order: null,
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
      itemRows: [
        {
          id: 'item-zero',
          product_id: 'prod-zero',
          variant_id: null,
          variant_name: null,
          name: 'Untaxed item',
          quantity: 1,
          price: 0,
        },
      ],
      transactions: [],
      paymentAccount: null,
      taxRows: [],
      paymentStatus: '',
      shippingStatus: '',
      currentDocumentKind: 'invoice',
    });

    expect(result.order.current_document_kind).toBe('invoice');
    expect(result.order.receipt_eligible).toBe(false);
    expect(result.order.currency).toBe('NGN');
    expect(result.receiptOrder.customer_name).toBe('Customer');
    expect(result.invoiceData.items).toEqual([
      expect.objectContaining({
        name: 'Untaxed item',
        vat_category_code: 'O',
        vat_rate: 0,
        vat_amount: 0,
      }),
    ]);
    expect(result.invoiceData.tax_exclusive_amount).toBe(0);
    expect(result.invoiceData.tax_inclusive_amount).toBe(0);
    expect(result.invoiceData.tax_subtotals).toEqual([
      {
        vat_category_code: 'O',
        vat_rate: 0,
        taxable_amount: 0,
        tax_amount: 0,
        exemption_reason: 'Outside scope of VAT',
      },
    ]);
    expect(result.invoiceData.merchant.vat_rate).toBe(0);
    expect(result.invoiceData.customer.address?.street).toBe('Pickup');
  });
});
