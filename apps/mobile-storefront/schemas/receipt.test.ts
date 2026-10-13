import {
  MerchantReceiptInfoSchema,
  ReceiptDetailSchema,
  ReceiptListItemSchema,
} from './receipt';

const listItem = {
  id: 'order-1',
  order_number: 'ORD-100',
  payment_status: 'paid',
  total: 150000,
  amount_paid: 150000,
  currency: 'NGN',
  created_at: '2026-08-01T12:00:00.000Z',
  transaction_date: '2026-07-16T00:30:00.000Z',
  invoice_issue_date: '2026-07-16',
  items: [
    {
      id: 'item-1',
      product_name: 'Test Phone',
      quantity: 1,
      price: 150000,
    },
  ],
};

const detailItem = {
  ...listItem,
  payment_method: null,
  subtotal: 150000,
  shipping_fee: 0,
  discount_amount: 0,
  tax_amount: 0,
  balance: 0,
  is_credit_order: false,
  notes: null,
  customer_name: 'Ada',
  customer_email: 'ada@example.com',
  customer_phone: null,
  shipping_address: null,
  virtual_account: null,
  transactions: [],
};

const merchantInfo = {
  business_name: 'OgaBassey',
  logo_url: null,
  email: 'support@example.com',
  phone: null,
  support_email: null,
  support_phone: null,
  business_address: null,
  cac_rc_number: null,
  tax_identification_number: null,
  legal_entity_name: null,
  brand_colors: { primary: '#111111', accent: '#222222' },
  vat_registration_status: null,
  vat_rate: null,
  bank_code: null,
  bank_name: 'Test Bank',
  bank_account_number: '0123456789',
  bank_account_name: 'OgaBassey Ltd',
  social_media: null,
  pages: null,
};

describe('ReceiptListItemSchema', () => {
  it('accepts the manual-order document dates', () => {
    const result = ReceiptListItemSchema.safeParse(listItem);
    expect(result.success).toBe(true);
  });

  it('accepts null document dates for legacy orders', () => {
    const result = ReceiptListItemSchema.safeParse({
      ...listItem,
      transaction_date: null,
      invoice_issue_date: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts missing document dates for legacy orders', () => {
    const { invoice_issue_date, transaction_date, ...legacy } = listItem;
    expect(invoice_issue_date).toBeDefined();
    expect(transaction_date).toBeDefined();
    expect(ReceiptListItemSchema.safeParse(legacy).success).toBe(true);
  });

  it('rejects non-string document dates', () => {
    const result = ReceiptListItemSchema.safeParse({
      ...listItem,
      transaction_date: 20260716,
    });
    expect(result.success).toBe(false);
  });
});

describe('ReceiptDetailSchema', () => {
  it('accepts the manual-order document dates', () => {
    const result = ReceiptDetailSchema.safeParse(detailItem);
    expect(result.success).toBe(true);
  });

  it('accepts null document dates for legacy orders', () => {
    const result = ReceiptDetailSchema.safeParse({
      ...detailItem,
      transaction_date: null,
      invoice_issue_date: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-string document dates', () => {
    const result = ReceiptDetailSchema.safeParse({
      ...detailItem,
      invoice_issue_date: 20260716,
    });
    expect(result.success).toBe(false);
  });
});

describe('MerchantReceiptInfoSchema', () => {
  it('accepts the partial legacy branding shape without a background color', () => {
    const result = MerchantReceiptInfoSchema.safeParse(merchantInfo);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.brand_colors).toEqual({
        primary: '#111111',
        accent: '#222222',
      });
    }
  });

  it('accepts a full branding shape with a background color', () => {
    const result = MerchantReceiptInfoSchema.safeParse({
      ...merchantInfo,
      brand_colors: {
        primary: '#111111',
        background: '#FFFFFF',
        accent: '#222222',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a null branding shape', () => {
    const result = MerchantReceiptInfoSchema.safeParse({
      ...merchantInfo,
      brand_colors: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects branding without the required primary color', () => {
    const result = MerchantReceiptInfoSchema.safeParse({
      ...merchantInfo,
      brand_colors: { accent: '#222222' },
    });
    expect(result.success).toBe(false);
  });
});
