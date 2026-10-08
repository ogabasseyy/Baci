import { describe, expect, it } from 'vitest';
import {
  adminOrderEditSchema,
  canEditFinancialOrderFields,
  getOrderEditChangeCategory,
} from './admin-order-edit';

const validPayload = {
  branch_id: '11111111-1111-4111-8111-111111111111',
  customer: {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Ada Buyer',
    email: 'ada@example.com',
    phone: '+2348012345678',
  },
  discount_amount: 500,
  gift_wrapping_fee: 0,
  items: [
    {
      image_url: 'https://cdn.example.test/iphone-13.jpg',
      name: 'iPhone 13',
      price: 500000,
      product_id: '33333333-3333-4333-8333-333333333333',
      product_match_status: 'linked',
      quantity: 1,
      variant_id: null,
      variant_attributes: { storage: '128GB', color: 'Black' },
      variant_name: null,
    },
  ],
  notes: 'Customer requested pickup.',
  notify_customer: true,
  shipping_address: {
    address: '12 Allen Avenue',
    city: 'Ikeja',
    name: 'Ada Buyer',
    phone: '+2348012345678',
    state: 'Lagos',
  },
  shipping_fee: 2500,
  source: 'physical',
  tax_amount: 37462.5,
};

describe('adminOrderEditSchema', () => {
  it('preserves backdated transaction dates', () => {
    const transaction_date = '2024-01-02T10:00:00.000Z';
    expect(
      adminOrderEditSchema.parse({ ...validPayload, transaction_date })
        .transaction_date
    ).toBe(transaction_date);
  });

  it.each([
    'not-a-date',
    '2024-02-31T10:00:00.000Z',
    '2999-01-01T00:00:00.000Z',
    null,
  ])('rejects invalid or future order dates: %s', (transaction_date) => {
    expect(
      adminOrderEditSchema.safeParse({ ...validPayload, transaction_date })
        .success
    ).toBe(false);
  });

  it('accepts the mobile-admin edit payload', () => {
    expect(adminOrderEditSchema.safeParse(validPayload).success).toBe(true);
  });

  it('accepts an explicit device calendar day', () => {
    const parsed = adminOrderEditSchema.parse({
      ...validPayload,
      transaction_date: '2024-01-02T10:00:00.000Z',
      transaction_date_day: '2024-01-02',
    });

    expect(parsed.transaction_date_day).toBe('2024-01-02');
  });

  it.each([
    '01/02/2024',
    '2024-02-31',
    '2024-1-2',
    20240102,
  ])('rejects malformed calendar days: %s', (transaction_date_day) => {
    expect(
      adminOrderEditSchema.safeParse({
        ...validPayload,
        transaction_date_day,
      }).success
    ).toBe(false);
  });

  it('rejects a lone calendar day without the instant', () => {
    const parsed = adminOrderEditSchema.safeParse({
      ...validPayload,
      transaction_date_day: '2024-01-02',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toContain(
        'Order date is required when the order day is present'
      );
    }
  });

  it('accepts legacy edit payloads that omit hidden gift wrapping', () => {
    const legacyPayload: Partial<typeof validPayload> = { ...validPayload };
    delete legacyPayload.gift_wrapping_fee;

    expect(adminOrderEditSchema.safeParse(legacyPayload).success).toBe(true);
  });

  it('accepts nullable source values from legacy or imported orders', () => {
    expect(
      adminOrderEditSchema.safeParse({ ...validPayload, source: null }).success
    ).toBe(true);
  });

  it('rejects blank customer name', () => {
    const result = adminOrderEditSchema.safeParse({
      ...validPayload,
      customer: { ...validPayload.customer, name: '   ' },
    });

    expect(result.success).toBe(false);
  });

  it('rejects an empty item list', () => {
    const result = adminOrderEditSchema.safeParse({
      ...validPayload,
      items: [],
    });

    expect(result.success).toBe(false);
  });

  it('rejects negative money fields', () => {
    const result = adminOrderEditSchema.safeParse({
      ...validPayload,
      shipping_fee: -1,
    });

    expect(result.success).toBe(false);
  });

  it('rejects discounts that would make the total negative', () => {
    const result = adminOrderEditSchema.safeParse({
      ...validPayload,
      discount_amount: 999999999,
      gift_wrapping_fee: 0,
      shipping_fee: 0,
      tax_amount: 0,
    });

    expect(result.success).toBe(false);
  });

  it('defers discount floor validation when hidden gift wrapping is omitted', () => {
    const payload: Partial<typeof validPayload> = {
      ...validPayload,
      discount_amount: 999999999,
      shipping_fee: 0,
      tax_amount: 0,
    };
    delete payload.gift_wrapping_fee;

    const result = adminOrderEditSchema.safeParse(payload);

    expect(result.success).toBe(true);
  });

  it('accepts a blank shipping address for pickup or physical sales', () => {
    const result = adminOrderEditSchema.safeParse({
      ...validPayload,
      shipping_address: {
        ...validPayload.shipping_address,
        address: '',
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts null city and state values from mobile blank-field normalization', () => {
    const result = adminOrderEditSchema.safeParse({
      ...validPayload,
      shipping_address: {
        ...validPayload.shipping_address,
        city: null,
        state: null,
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts custom items that omit product match status', () => {
    const result = adminOrderEditSchema.safeParse({
      ...validPayload,
      items: [
        {
          image_url: null,
          item_description: 'Manual line item',
          name: 'Custom setup service',
          price: 5000,
          product_id: null,
          quantity: 1,
          variant_id: null,
          variant_attributes: null,
          variant_name: null,
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});

describe('order edit helpers', () => {
  it('classifies item or money changes as financial', () => {
    expect(
      getOrderEditChangeCategory({
        changedFields: ['items', 'shipping_fee'],
      })
    ).toBe('financial');
  });

  it('classifies customer changes as customer-visible', () => {
    expect(
      getOrderEditChangeCategory({
        changedFields: ['customer_phone'],
      })
    ).toBe('customer_visible');
  });

  it('classifies notes-only changes as internal', () => {
    expect(getOrderEditChangeCategory({ changedFields: ['notes'] })).toBe(
      'internal'
    );
  });

  it('allows financial edits only before payment and fulfillment', () => {
    expect(
      canEditFinancialOrderFields({
        amountPaid: 0,
        paymentStatus: 'unpaid',
        shippingStatus: 'pending',
        walletAmountUsed: 0,
      })
    ).toBe(true);

    expect(
      canEditFinancialOrderFields({
        amountPaid: 100,
        paymentStatus: 'unpaid',
        shippingStatus: 'pending',
        walletAmountUsed: 0,
      })
    ).toBe(false);

    expect(
      canEditFinancialOrderFields({
        amountPaid: 0,
        paymentStatus: 'unpaid',
        shippingStatus: 'shipped',
        walletAmountUsed: 0,
      })
    ).toBe(false);

    expect(
      canEditFinancialOrderFields({
        amountPaid: 0,
        paymentStatus: 'paid',
        shippingStatus: 'pending',
        walletAmountUsed: 0,
      })
    ).toBe(false);

    expect(
      canEditFinancialOrderFields({
        amountPaid: 0,
        paymentStatus: 'unpaid',
        shippingStatus: 'pending',
        walletAmountUsed: 100,
      })
    ).toBe(false);
  });
});
