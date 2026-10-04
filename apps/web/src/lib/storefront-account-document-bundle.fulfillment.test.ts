import { describe, expect, it } from 'vitest';
import { buildStorefrontAccountDocumentBundle } from '@/lib/storefront-account-document-bundle';

type BundleInput = Parameters<typeof buildStorefrontAccountDocumentBundle>[0];

function createBundleInput(itemRows: BundleInput['itemRows']): BundleInput {
  return {
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
      first_name: 'Ada',
      last_name: 'Customer',
      email: 'ada@example.com',
      phone: null,
    },
    order: {
      id: 'order-1',
      order_number: 'ORD-1001',
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
      tax_inclusive_amount: null,
      invoice_note: null,
      firs_irn: null,
      firs_csid: null,
      firs_qr_code: null,
      payment_terms: null,
    },
    itemRows,
    transactions: [],
    paymentAccount: null,
    taxRows: [],
    paymentStatus: 'paid',
    shippingStatus: 'shipped',
    currentDocumentKind: 'receipt',
  };
}

function createBundleInputWithOrder(
  order: Partial<BundleInput['order']>,
  itemRows: BundleInput['itemRows']
): BundleInput {
  const baseInput = createBundleInput(itemRows);

  return {
    ...baseInput,
    order: {
      ...baseInput.order,
      ...order,
    },
  };
}

describe('buildStorefrontAccountDocumentBundle fulfillment fallbacks', () => {
  it('prefers normalized fulfillment details over raw fulfillment data', () => {
    const result = buildStorefrontAccountDocumentBundle(
      createBundleInput([
        {
          id: 'item-1',
          product_id: 'product-1',
          variant_id: null,
          variant_name: null,
          name: 'iPhone 16',
          quantity: 1,
          price: 100000,
          fulfillment_data: {
            imei: 'RAW-IMEI',
          },
          fulfillment_details: {
            imei: 'DETAILS-IMEI',
          },
        },
      ])
    );

    expect(result.invoiceData.items[0]?.description).toContain(
      'IMEI: DETAILS-IMEI'
    );
    expect(result.invoiceData.items[0]?.description).not.toContain('RAW-IMEI');
  });

  it('keeps invoice items valid when no line fulfillment data exists', () => {
    const result = buildStorefrontAccountDocumentBundle(
      createBundleInput([
        {
          id: 'item-1',
          product_id: 'product-1',
          variant_id: null,
          variant_name: null,
          name: 'Test Product',
          quantity: 1,
          price: 100000,
        },
      ])
    );

    expect(result.invoiceData.items[0]?.name).toBe('Test Product');
    expect(result.invoiceData.items[0]?.description).toBeUndefined();
  });

  it('falls back to raw fulfillment data when normalized details are empty', () => {
    const result = buildStorefrontAccountDocumentBundle(
      createBundleInput([
        {
          id: 'item-1',
          product_id: 'product-1',
          variant_id: null,
          variant_name: null,
          name: 'iPhone 16',
          quantity: 1,
          price: 100000,
          fulfillment_data: {
            imei: 'RAW-IMEI',
          },
          fulfillment_details: {},
        },
      ])
    );

    expect(result.invoiceData.items[0]?.description).toContain(
      'IMEI: RAW-IMEI'
    );
    expect(result.invoiceData.items[0]?.description).not.toContain(
      'DETAILS-IMEI'
    );
  });

  it('attaches order-level fulfillment items to matching invoice lines', () => {
    const result = buildStorefrontAccountDocumentBundle(
      createBundleInputWithOrder(
        {
          fulfillment_details: {
            items: [
              {
                imei: '111111111111111',
                orderItemId: 'item-1',
              },
              {
                orderItemId: 'item-2',
                serialNumber: 'SN-SECOND',
              },
            ],
          },
        },
        [
          {
            id: 'item-1',
            product_id: 'product-1',
            variant_id: null,
            variant_name: null,
            name: 'Leather Case',
            quantity: 1,
            price: 100000,
          },
          {
            id: 'item-2',
            product_id: 'product-2',
            variant_id: null,
            variant_name: null,
            name: 'iPhone 16',
            quantity: 1,
            price: 900000,
          },
        ]
      )
    );

    expect(result.invoiceData.items[0]?.description).toContain(
      'IMEI: 111111111111111'
    );
    expect(result.invoiceData.items[0]?.description).not.toContain('SN-SECOND');
    expect(result.invoiceData.items[1]?.description).toContain(
      'S/N: SN-SECOND'
    );
    expect(result.invoiceData.items[1]?.description).not.toContain(
      '111111111111111'
    );
  });

  it('preserves order-level fulfillment fallback when item entries do not match', () => {
    const result = buildStorefrontAccountDocumentBundle(
      createBundleInputWithOrder(
        {
          fulfillment_details: {
            imei: 'ORDER-LEVEL-IMEI',
            items: [
              {
                orderItemId: 'missing-item',
                serialNumber: 'UNMATCHED-SERIAL',
              },
            ],
          },
        },
        [
          {
            id: 'item-1',
            product_id: 'product-1',
            variant_id: null,
            variant_name: null,
            name: 'Leather Case',
            quantity: 1,
            price: 100000,
          },
          {
            id: 'item-2',
            product_id: 'product-2',
            variant_id: null,
            variant_name: null,
            name: 'iPhone 16',
            quantity: 1,
            price: 900000,
          },
        ]
      )
    );

    expect(result.invoiceData.items[0]?.description).toBeUndefined();
    expect(result.invoiceData.items[1]?.description).toContain(
      'IMEI: ORDER-LEVEL-IMEI'
    );
    expect(result.invoiceData.items[1]?.description).not.toContain(
      'UNMATCHED-SERIAL'
    );
  });

  it('matches fulfillment entries by stored line id, not position', () => {
    // biome-ignore format: compact fixture preserves the 300-line gate.
    const item = (id: string, line_id: number, name: string) => ({ id, line_id, product_id: `product-${id}`, variant_id: null, variant_name: null, name, quantity: 1, price: 50000 });
    const result = buildStorefrontAccountDocumentBundle(
      createBundleInputWithOrder(
        {
          fulfillment_details: {
            items: [{ orderItemId: '5', imei: 'LINE-5-IMEI' }],
          },
        },
        [item('item-5', 5, 'Widget A'), item('item-2', 2, 'Widget B')]
      )
    );

    expect(result.receiptOrder.items.map((row) => row.line_id)).toEqual([5, 2]);
    expect(result.invoiceData.items[0]?.description).toContain(
      'IMEI: LINE-5-IMEI'
    );
    expect(result.invoiceData.items[1]?.description ?? '').not.toContain(
      'LINE-5-IMEI'
    );
  });
});
