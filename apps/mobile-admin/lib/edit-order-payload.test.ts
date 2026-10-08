import { describe, expect, it } from 'vitest';
import type { OrderItem } from '@/components/orders/new-order.types';
import {
  buildEditOrderPayload,
  isOrderFinanciallyLocked,
  resolveEditOrderDate,
} from './edit-order-payload';

const orderItems: OrderItem[] = [
  {
    condition: 'new',
    details: 'Battery health 89%',
    id: 'line-1',
    image_url: 'https://example.test/phone.jpg',
    name: 'Phone',
    price: 1000,
    product_id: 'product-1',
    product_match_status: 'linked',
    quantity: 2,
    variant_attributes: { color: 'Blue', storage: '512GB' },
    variant_id: 'variant-1',
    variant_name: 'Blue / 512GB',
  },
];

type EditOrderPayloadInput = Parameters<typeof buildEditOrderPayload>[0];

function buildPayload(
  overrides: Partial<EditOrderPayloadInput> = {}
): ReturnType<typeof buildEditOrderPayload> {
  return buildEditOrderPayload({
    customer: {
      address: '1 Baci Road',
      email: 'ada@example.com',
      id: 'customer-1',
      name: 'Ada Buyer',
      phone: '08030000000',
    },
    deliveryInfo: {
      address: '22 Delivery Lane',
      city: 'Ikeja',
      name: 'Receiver',
      phone: '08039999999',
      state: 'Lagos',
    },
    discount: 0,
    notes: '',
    notifyCustomer: false,
    orderItems,
    sameAsCustomer: false,
    selectedBranchId: null,
    selectedChannel: 'physical',
    shippingFee: 0,
    taxesToUse: 0,
    ...overrides,
  });
}

describe('isOrderFinanciallyLocked', () => {
  it('locks paid, fulfilled, wallet-funded, and terminal orders from financial edits', () => {
    const lockedStates = [
      { amount_paid: 1, payment_status: 'pending', shipping_status: 'pending' },
      { amount_paid: 0, payment_status: 'paid', shipping_status: 'pending' },
      { amount_paid: 0, payment_status: 'pending', shipping_status: 'shipped' },
      {
        amount_paid: 0,
        payment_status: 'pending',
        shipping_status: 'pending',
        wallet_amount_used: 500,
      },
    ];

    for (const state of lockedStates) {
      expect(
        isOrderFinanciallyLocked({ wallet_amount_used: 0, ...state })
      ).toBe(true);
    }

    expect(
      isOrderFinanciallyLocked({
        amount_paid: 0,
        payment_status: 'pending',
        shipping_status: 'pending',
        wallet_amount_used: 0,
      })
    ).toBe(false);
  });
});

describe('buildEditOrderPayload', () => {
  it('builds the full replacement payload with item snapshot fields and notify flag', () => {
    expect(
      buildPayload({
        customer: {
          address: '1 Baci Road',
          email: 'ADA@EXAMPLE.COM',
          id: 'customer-1',
          name: ' Ada Buyer ',
          phone: '08030000000',
        },
        deliveryInfo: {
          address: '22 Delivery Lane',
          city: 'Ikeja',
          name: 'Receiver',
          phone: '08039999999',
          state: 'Lagos',
        },
        discount: 100,
        notes: '  Handle carefully  ',
        notifyCustomer: true,
        orderItems,
        sameAsCustomer: false,
        selectedBranchId: 'branch-1',
        selectedChannel: 'physical',
        shippingFee: 250,
        taxesToUse: 75,
      })
    ).toEqual({
      branch_id: 'branch-1',
      customer: {
        email: 'ada@example.com',
        id: 'customer-1',
        name: 'Ada Buyer',
        phone: '08030000000',
      },
      discount_amount: 100,
      items: [
        {
          condition: 'new',
          image_url: 'https://example.test/phone.jpg',
          item_description: 'Battery health 89%',
          name: 'Phone',
          price: 1000,
          product_id: 'product-1',
          product_match_status: 'linked',
          quantity: 2,
          variant_attributes: { color: 'Blue', storage: '512GB' },
          variant_id: 'variant-1',
          variant_name: 'Blue / 512GB',
        },
      ],
      notes: 'Handle carefully',
      notify_customer: true,
      shipping_address: {
        address: '22 Delivery Lane',
        city: 'Ikeja',
        name: 'Receiver',
        phone: '08039999999',
        state: 'Lagos',
      },
      shipping_fee: 250,
      source: 'physical',
      tax_amount: 75,
    });
  });

  it('uses customer details for shipping when sameAsCustomer is true', () => {
    const payload = buildPayload({
      sameAsCustomer: true,
    });

    expect(payload.shipping_address).toEqual({
      address: '1 Baci Road',
      city: null,
      name: 'Ada Buyer',
      phone: '08030000000',
      state: null,
    });
  });

  it('does not reuse stale delivery city/state when shipping matches the selected customer', () => {
    const payload = buildPayload({
      deliveryInfo: {
        address: '22 Delivery Lane',
        city: 'Old City',
        name: 'Receiver',
        phone: '08039999999',
        state: 'Old State',
      },
      sameAsCustomer: true,
    });

    expect(payload.shipping_address).toMatchObject({
      address: '1 Baci Road',
      city: null,
      state: null,
    });
  });

  it('normalizes blank delivery city and state to null', () => {
    const payload = buildPayload({
      deliveryInfo: {
        address: '22 Delivery Lane',
        city: '   ',
        name: 'Receiver',
        phone: '08039999999',
        state: '',
      },
    });

    expect(payload.shipping_address).toMatchObject({
      city: null,
      state: null,
    });
  });

  it('preserves variant snapshot fields when a linked item has no variant id', () => {
    const payload = buildPayload({
      orderItems: [
        {
          ...orderItems[0],
          variant_attributes: { color: 'Blue' },
          variant_id: null,
          variant_name: 'Blue',
        },
      ],
    });

    expect(payload.items[0]).toMatchObject({
      variant_attributes: { color: 'Blue' },
      variant_id: null,
      variant_name: 'Blue',
    });
  });

  it('preserves unreviewed product match status before submit', () => {
    const payload = buildPayload({
      orderItems: [
        {
          ...orderItems[0],
          is_custom: false,
          product_id: null,
          product_match_status: 'unreviewed',
        },
      ],
    });

    expect(payload.items[0]).toMatchObject({
      product_id: null,
      product_match_status: 'unreviewed',
    });
  });

  it('uses the walk-in customer fallback for blank customer names', () => {
    const payload = buildPayload({
      customer: {
        address: '',
        email: '',
        id: null,
        name: '   ',
        phone: '',
      },
      deliveryInfo: { address: '', city: '', name: '', phone: '', state: '' },
      sameAsCustomer: true,
    });

    expect(payload.customer.name).toBe('Walk-in Customer');
  });
});

describe('buildEditOrderPayload order date', () => {
  it('sends the picked calendar day alongside the instant', () => {
    const payload = buildPayload({ orderDate: new Date(2024, 0, 5, 18, 30) });

    expect(payload.transaction_date).toBe(
      new Date(2024, 0, 5, 18, 30).toISOString()
    );
    expect(payload.transaction_date_day).toBe('2024-01-05');
  });

  it('omits date fields when the date is unchanged', () => {
    const payload = buildPayload({ orderDate: undefined });

    expect(payload).not.toHaveProperty('transaction_date');
    expect(payload).not.toHaveProperty('transaction_date_day');
  });
});

describe('resolveEditOrderDate', () => {
  it('returns the current date untouched when there is no saved order', () => {
    const currentDate = new Date('2024-01-02T10:00:00.000Z');

    expect(resolveEditOrderDate({ currentDate, hasSavedOrder: false })).toBe(
      currentDate
    );
  });

  it('omits the date when the saved date is missing or unparseable', () => {
    const currentDate = new Date(2024, 0, 5, 18, 30);

    expect(
      resolveEditOrderDate({ currentDate, hasSavedOrder: true })
    ).toBeUndefined();
    expect(
      resolveEditOrderDate({
        currentDate,
        hasSavedOrder: true,
        savedCreatedAt: 'not-a-date',
      })
    ).toBeUndefined();
  });

  it('omits the date when the calendar day is unchanged', () => {
    const currentDate = new Date(2024, 0, 2, 18, 30);

    expect(
      resolveEditOrderDate({
        currentDate,
        hasSavedOrder: true,
        savedTransactionDate: new Date(2024, 0, 2, 10, 0).toISOString(),
      })
    ).toBeUndefined();
  });

  it('normalizes a changed day to local midnight', () => {
    const resolved = resolveEditOrderDate({
      currentDate: new Date(2024, 0, 5, 18, 30),
      hasSavedOrder: true,
      savedTransactionDate: new Date(2024, 0, 2, 10, 0).toISOString(),
    });

    expect(resolved?.getTime()).toBe(new Date(2024, 0, 5).getTime());
  });
});
