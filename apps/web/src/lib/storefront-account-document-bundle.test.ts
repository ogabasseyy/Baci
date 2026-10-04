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
          metadata: { payment_method: 'card' },
          status: 'completed',
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
    expect(result.receiptOrder.transactions).toHaveLength(1);
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

  it('derives zero-rated invoice subtotals from selected line VAT metadata', () => {
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
        vat_registration_status: 'registered',
        vat_rate: 7.5,
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
        id: 'order-zero-rated',
        order_number: 'ORD-ZERO',
        created_at: '2026-03-22T10:00:00.000Z',
        updated_at: null,
        payment_status: 'paid',
        shipping_status: 'shipped',
        currency: 'NGN',
        total: 100000,
        subtotal: 100000,
        shipping_fee: 0,
        tax_amount: 0,
        discount_amount: 0,
        amount_paid: 100000,
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
        tax_inclusive_amount: 100000,
        invoice_note: null,
        firs_irn: null,
        firs_csid: null,
        firs_qr_code: null,
        payment_terms: null,
      },
      itemRows: [
        {
          id: 'item-zero-rated',
          product_id: 'prod-zero-rated',
          variant_id: null,
          variant_name: null,
          name: 'Zero-rated accessory',
          quantity: 1,
          price: 100000,
          line_extension_amount: 100000,
          vat_category_code: 'Z',
          vat_rate: 0,
          vat_amount: 0,
        },
      ],
      transactions: [],
      paymentAccount: null,
      taxRows: [],
      paymentStatus: 'paid',
      shippingStatus: 'shipped',
      currentDocumentKind: 'receipt',
    });

    expect(result.invoiceData.items[0]).toEqual(
      expect.objectContaining({
        vat_category_code: 'Z',
        vat_rate: 0,
        vat_amount: 0,
      })
    );
    expect(result.invoiceData.tax_subtotals).toEqual([
      {
        vat_category_code: 'Z',
        vat_rate: 0,
        taxable_amount: 100000,
        tax_amount: 0,
        exemption_reason: undefined,
      },
    ]);
  });

  it('includes shipping and discounts in synthesized non-VAT taxable totals', () => {
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
        first_name: 'Oga',
        last_name: 'Bassey',
        email: 'customer@example.com',
        phone: null,
      },
      order: {
        id: 'order-non-vat-shipping',
        order_number: 'ORD-NON-VAT',
        created_at: '2026-03-22T10:00:00.000Z',
        updated_at: null,
        payment_status: 'unpaid',
        shipping_status: 'processing',
        currency: 'NGN',
        total: 104000,
        subtotal: 100000,
        shipping_fee: 5000,
        tax_amount: 0,
        discount_amount: 1000,
        amount_paid: 0,
        shipping_address: null,
        customer_name: null,
        customer_email: null,
        customer_phone: null,
        payment_method: 'invoice',
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
      itemRows: [
        {
          id: 'item-non-vat',
          product_id: 'prod-non-vat',
          variant_id: null,
          variant_name: null,
          name: 'Non-VAT item',
          quantity: 1,
          price: 100000,
        },
      ],
      transactions: [],
      paymentAccount: null,
      taxRows: [],
      paymentStatus: 'unpaid',
      shippingStatus: 'processing',
      currentDocumentKind: 'invoice',
    });

    expect(result.invoiceData.tax_exclusive_amount).toBe(104000);
    expect(result.invoiceData.tax_subtotals).toEqual([
      {
        vat_category_code: 'O',
        vat_rate: 0,
        taxable_amount: 104000,
        tax_amount: 0,
        exemption_reason: 'Outside scope of VAT',
      },
    ]);
  });

  it('omits blanket line VAT metadata when multiple tax buckets are present', () => {
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
        vat_rate: 7.5,
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
        id: 'order-3',
        order_number: 'ORD-1003',
        created_at: '2026-03-22T10:00:00.000Z',
        updated_at: null,
        payment_status: 'paid',
        shipping_status: 'shipped',
        currency: 'NGN',
        total: 109000,
        subtotal: 100000,
        shipping_fee: 4000,
        tax_amount: 5000,
        discount_amount: 0,
        amount_paid: 109000,
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
        tax_inclusive_amount: 109000,
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
          name: 'Mixed Tax Item',
          quantity: 1,
          price: 100000,
        },
      ],
      transactions: [],
      paymentAccount: null,
      taxRows: [
        {
          vat_category_code: 'S',
          vat_rate: 7.5,
          taxable_amount: 70000,
          tax_amount: 3500,
          exemption_reason: null,
        },
        {
          vat_category_code: 'E',
          vat_rate: 0,
          taxable_amount: 30000,
          tax_amount: 1500,
          exemption_reason: 'Mixed exemption',
        },
      ],
      paymentStatus: 'paid',
      shippingStatus: 'shipped',
      currentDocumentKind: 'receipt',
    });

    expect(result.invoiceData.items[0]).not.toHaveProperty('vat_category_code');
    expect(result.invoiceData.items[0]).not.toHaveProperty('vat_rate');
    expect(result.invoiceData.items[0]).not.toHaveProperty('vat_amount');
    expect(result.invoiceData.tax_exclusive_amount).toBe(104000);
  });

  it.each([
    {
      label: 'unpaid invoice order holding the stored 380 default',
      paymentMethod: 'invoice',
      paymentStatus: 'unpaid',
      storedTypeCode: '380',
      expected: '325',
    },
    {
      label: 'unpaid invoice order without a stored code',
      paymentMethod: 'invoice',
      paymentStatus: 'unpaid',
      storedTypeCode: null,
      expected: '325',
    },
    {
      label: 'paid invoice order',
      paymentMethod: 'invoice',
      paymentStatus: 'paid',
      storedTypeCode: '380',
      expected: '380',
    },
    {
      label: 'card order with the stored default',
      paymentMethod: 'card',
      paymentStatus: 'unpaid',
      storedTypeCode: '380',
      expected: '380',
    },
  ])('resolves $expected for an $label', ({
    paymentMethod,
    paymentStatus,
    storedTypeCode,
    expected,
  }) => {
    const result = buildStorefrontAccountDocumentBundle({
      merchant: {
        business_name: 'Test Store',
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
        vat_rate: null,
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
        id: 'order-proforma-1',
        order_number: 'INV-00042',
        created_at: '2026-09-01T10:00:00.000Z',
        updated_at: null,
        payment_status: 'unpaid',
        shipping_status: 'pending',
        currency: 'NGN',
        total: 110000,
        subtotal: 100000,
        shipping_fee: 0,
        tax_amount: 10000,
        discount_amount: 0,
        amount_paid: 0,
        shipping_address: null,
        customer_name: null,
        customer_email: null,
        customer_phone: null,
        payment_method: paymentMethod,
        is_credit_order: false,
        tracking_number: null,
        shipping_provider: null,
        invoice_type_code: storedTypeCode,
        invoice_issue_date: null,
        tax_point_date: null,
        payment_due_date: null,
        buyer_reference: null,
        purchase_order_reference: null,
        tax_exclusive_amount: 100000,
        tax_inclusive_amount: 110000,
        invoice_note: null,
        firs_irn: null,
        firs_csid: null,
        firs_qr_code: null,
        payment_terms: null,
        notes: null,
      },
      itemRows: [
        {
          id: 'item-1',
          product_id: 'prod-1',
          variant_id: null,
          variant_name: null,
          name: 'Proforma Widget',
          quantity: 1,
          price: 100000,
          vat_category_code: null,
          vat_rate: null,
          vat_amount: null,
        },
      ],
      transactions: [],
      paymentAccount: null,
      taxRows: [],
      paymentStatus,
      shippingStatus: 'pending',
      currentDocumentKind: 'invoice',
    });

    expect(result.invoiceData.invoice_type_code).toBe(expected);
    // Account views label from the customer-facing order projection, so it
    // must carry the same resolved code as the generated invoice.
    expect(result.order.invoice_type_code).toBe(expected);
  });
});
