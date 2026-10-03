import { describe, expect, it } from 'vitest';
import {
  getReceiptDisplaySubtotal,
  getReceiptItemDetailLines,
  getReceiptItemLineTotal,
  getReceiptItemVatLines,
  shouldShowVatLine,
} from './receipt-money';
import type { ReceiptMerchant, ReceiptOrder } from './types';

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
    amount_paid: 500000,
    balance: 0,
    payment_status: 'paid',
    payment_method: 'card',
    customer_name: 'Akinola Ogunniran',
    customer_email: 'akin@example.com',
    customer_phone: null,
    items: [
      {
        product_name: 'Samsung Galaxy S22 Ultra',
        quantity: 1,
        price: 500000,
      },
    ],
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
    vat_registration_status: 'registered',
    vat_rate: 7.5,
    bank_code: null,
    bank_account_number: null,
    ...overrides,
  };
}

describe('receipt VAT visibility', () => {
  function createBackfilledShippingOrder(): ReceiptOrder {
    return createReceiptOrder({
      subtotal: 1005125,
      shipping_fee: 1000,
      tax_amount: 70125,
      total: 1005125,
    });
  }

  it('shows VAT when subtotal was backfilled from a tax-inclusive total with shipping', () => {
    expect(
      shouldShowVatLine(
        createBackfilledShippingOrder(),
        createReceiptMerchant()
      )
    ).toBe(true);
  });

  it('removes shipping from the display subtotal for backfilled tax-inclusive totals', () => {
    expect(
      getReceiptDisplaySubtotal(
        createBackfilledShippingOrder(),
        createReceiptMerchant()
      )
    ).toBe(934000);
  });

  it.each([
    [
      'unregistered merchant',
      createReceiptMerchant({ vat_registration_status: null }),
    ],
    ['zero tax amount', createReceiptMerchant()],
  ])('hides VAT for %s', (_label, merchant) => {
    const order = createReceiptOrder({
      subtotal: 935000,
      tax_amount: merchant.vat_registration_status === 'registered' ? 0 : 70125,
      total: 1005125,
    });

    expect(shouldShowVatLine(order, merchant)).toBe(false);
  });

  it('returns the raw subtotal for clean tax-exclusive totals', () => {
    const order = createReceiptOrder({
      subtotal: 935000,
      tax_amount: 70125,
      total: 1005125,
    });

    expect(getReceiptDisplaySubtotal(order, createReceiptMerchant())).toBe(
      935000
    );
  });
});

describe('receipt line helpers', () => {
  it('prefers an explicit extension over quantity x price', () => {
    expect(
      getReceiptItemLineTotal({ price: 1000, quantity: 2 })
    ).toBe(2000);
    expect(
      getReceiptItemLineTotal({
        price: 1000,
        quantity: 2,
        line_extension_amount: 1500,
      })
    ).toBe(1500);
    expect(
      getReceiptItemLineTotal({
        price: 1000,
        quantity: 2,
        line_extension_amount: Number.NaN,
      })
    ).toBe(2000);
  });

  it('builds the shared SKU/Unit/VAT detail labels', () => {
    const item = {
      price: 1000,
      quantity: 2,
      sellers_item_id: 'SKU-1',
      unit_code: 'EA',
      vat_rate: 7.5,
      vat_amount: 112.5,
    };
    expect(getReceiptItemDetailLines(item)).toEqual([
      'SKU: SKU-1',
      'Unit: EA',
    ]);
    expect(getReceiptItemVatLines(item, (n) => `NGN ${n}`)).toEqual([
      'VAT: 7.50%',
      'NGN 112.5',
    ]);
    expect(getReceiptItemDetailLines({ price: 1, quantity: 1 })).toEqual([]);
    expect(
      getReceiptItemVatLines({ price: 1, quantity: 1 }, (n) => `NGN ${n}`)
    ).toEqual([]);
  });
});
