import { describe, expect, it } from 'vitest';
import { buildStorefrontAccountDocumentBundle } from '@/lib/storefront-account-document-bundle';

describe('buildStorefrontAccountDocumentBundle', () => {
  it('builds invoice, receipt, and order payloads from normalized input data', () => {
    const result = buildStorefrontAccountDocumentBundle({
      merchant: {
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
          street: '12 Allen Avenue',
          city: 'Lagos',
          state: 'Lagos',
          postal_code: '100001',
          country: 'NG',
        },
      },
      customer: {
        first_name: 'Oga',
        last_name: 'Bassey',
        email: 'customer@example.com',
        phone: '08022222222',
      },
      order: {
        id: 'order-1',
        order_number: 'ORD-1001',
        created_at: '2026-03-22T10:00:00.000Z',
        updated_at: '2026-03-22T11:00:00.000Z',
        payment_status: 'paid',
        shipping_status: 'shipped',
        currency: 'NGN',
        total: 110000,
        subtotal: 100000,
        shipping_fee: 5000,
        tax_amount: 5000,
        discount_amount: 0,
        amount_paid: 110000,
        shipping_address: {
          address_line1: '12 Allen Avenue',
          city: 'Lagos',
          state: 'Lagos',
          postal_code: '100001',
          country: 'NG',
        },
        customer_name: null,
        customer_email: null,
        customer_phone: null,
        payment_method: 'card',
        is_credit_order: false,
        tracking_number: 'TRACK-1',
        shipping_provider: 'MERCHANT',
        shipping_rate_id: 'rate-1',
        shipping_rate_name: 'Express Delivery',
        notes: 'Leave at the gate',
        invoice_type_code: '380',
        invoice_issue_date: null,
        tax_point_date: null,
        payment_due_date: null,
        buyer_reference: null,
        purchase_order_reference: null,
        tax_exclusive_amount: 100000,
        tax_inclusive_amount: 110000,
        invoice_note: null,
        firs_irn: 'IRN-2026-001',
        firs_csid: 'CSID-2026-001',
        firs_qr_code: null,
        payment_terms: null,
      },
      itemRows: [
        {
          id: 'item-1',
          product_id: 'prod-1',
          variant_id: null,
          variant_name: 'Blue / 128GB',
          condition: 'open_box',
          name: 'iPhone 16',
          quantity: 1,
          price: 100000,
          vat_category_code: 'S',
          vat_rate: 7.5,
          vat_amount: 0,
          fulfillment_data: {
            imei: 'IMEI-123',
            serial_number: 'SN-456',
          },
        },
      ],
      transactions: [
        {
          id: 'tx-1',
          amount: 110000,
          created_at: '2026-03-22T10:10:00.000Z',
          description: 'Card payment',
          // Staff-recorded shape: the mapper keeps only the DVA entry
          // in metadata and surfaces the method beside it.
          metadata: { dva_account_number: '9990001111' },
          payment_method: 'bank_transfer',
          status: 'completed',
          transaction_type: 'payment',
        },
        // Non-payments never reach customer payment surfaces: a failed
        // retry and a still-pending attempt moved no money, so neither
        // belongs in the history card nor the receipt listing.
        {
          id: 'tx-2',
          amount: 110000,
          created_at: '2026-03-22T10:05:00.000Z',
          description: 'Card payment',
          metadata: { payment_method: 'card' },
          status: 'failed',
        },
        {
          id: 'tx-3',
          amount: 110000,
          created_at: '2026-03-22T10:06:00.000Z',
          description: 'Card payment',
          metadata: { payment_method: 'card' },
          status: 'pending',
        },
        // A completed non-payment type is confirmed but not a payment:
        // it must not render as a positive Payment History row.
        {
          id: 'tx-4',
          amount: 110000,
          created_at: '2026-03-22T10:07:00.000Z',
          description: 'Refund issued',
          metadata: null,
          status: 'completed',
          transaction_type: 'refund',
        },
      ],
      paymentAccount: {
        account_number: '1234567890',
        bank_name: 'Baci Bank',
        account_name: 'Ogabassey Ltd',
      },
      taxRows: [],
      paymentStatus: 'paid',
      shippingStatus: 'shipped',
      currentDocumentKind: 'receipt',
    });

    expect(result.order.current_document_kind).toBe('receipt');
    expect(result.order.receipt_eligible).toBe(true);
    expect(result.order.is_manual_order).toBe(false);
    expect(result.order.manual_document_available).toBe(false);
    expect(result.order.customer_name).toBe('Oga Bassey');
    expect(result.order.shipping_rate_id).toBe('rate-1');
    expect(result.order.shipping_rate_name).toBe('Express Delivery');
    expect(result.invoiceData.items[0]?.name).toBe(
      'iPhone 16 (Open Box / Blue / 128GB)'
    );
    expect(result.receiptOrder.items[0]).toEqual(
      expect.objectContaining({
        condition: 'open_box',
        variant_name: 'Blue / 128GB, Open Box',
      })
    );
    expect(result.invoiceData.items[0]?.description).toContain(
      'IMEI: IMEI-123'
    );
    expect(result.invoiceData.items[0]?.description).toContain('S/N: SN-456');
    expect(result.invoiceData.items[0]?.vat_amount).toBe(5000);
    expect(result.invoiceData.items[0]?.vat_category_code).toBe('S');
    expect(result.invoiceData.amount_paid).toBe(110000);
    expect(result.invoiceData.firs_irn).toBe('IRN-2026-001');
    expect(result.order.transactions?.map((entry) => entry.id)).toEqual([
      'tx-1',
    ]);
    // The staff-recorded method merges back into metadata on both
    // payloads, so downloads print it like the emailed PDF.
    expect(result.order.transactions?.[0]?.metadata).toEqual({
      dva_account_number: '9990001111',
      payment_method: 'bank_transfer',
    });
    expect(result.receiptOrder.transactions).toHaveLength(1);
    expect(result.receiptOrder.transactions?.[0]?.metadata).toEqual({
      dva_account_number: '9990001111',
      payment_method: 'bank_transfer',
    });
    expect(result.receiptOrder.virtual_account?.account_number).toBe(
      '1234567890'
    );
    expect(result.invoiceData.customer.address?.street).toBe('12 Allen Avenue');
    expect(result.invoiceData.tax_subtotals).toEqual([
      {
        vat_category_code: 'S',
        vat_rate: 7.5,
        taxable_amount: 100000,
        tax_amount: 5000,
      },
    ]);
  });
});
