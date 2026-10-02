import { describe, expect, it } from 'vitest';
import {
  getCurrentDocumentKind,
  isManualOrderDocumentAvailable,
  isReceiptEligible,
} from '@/lib/storefront-account-document-eligibility';

const validMoney = {
  total: 100,
  subtotal: 100,
  shipping_fee: 0,
  tax_amount: 0,
  discount_amount: 0,
  amount_paid: 100,
};
const validItems = [{ name: 'Device', quantity: 1, price: 100 }];

function manualInput(overrides: Record<string, unknown> = {}) {
  return {
    paymentStatus: 'unpaid',
    shippingStatus: 'pending',
    recordedByUserId: 'staff-1',
    total: 100,
    amountPaid: 0,
    money: validMoney,
    items: validItems,
    ...overrides,
  };
}

describe('storefront account document content validity', () => {
  it('hides itemless manual orders until the item batch lands', () => {
    const input = {
      paymentStatus: 'paid',
      shippingStatus: 'pending',
      recordedByUserId: 'staff-1',
      total: 100,
      amountPaid: 100,
      money: {
        total: 100,
        subtotal: 100,
        shipping_fee: 0,
        tax_amount: 0,
        discount_amount: 0,
        amount_paid: 100,
      },
      items: [] as { name: string; quantity: number; price: number }[],
    };
    expect(isManualOrderDocumentAvailable(input)).toBe(false);
    expect(isReceiptEligible(input)).toBe(false);
    expect(getCurrentDocumentKind(input)).toBe('invoice');
    const withItems = {
      ...input,
      items: [{ name: 'Device', quantity: 1, price: 100 }],
    };
    expect(isManualOrderDocumentAvailable(withItems)).toBe(true);
    expect(isReceiptEligible(withItems)).toBe(true);
  });

  it.each([
    ['total', -5],
    ['subtotal', -5],
    ['shipping_fee', -5],
    ['tax_amount', -5],
    ['discount_amount', -5],
    ['amount_paid', -5],
    ['total', 'bogus'],
  ] as const)('hides unpaid orders with an invalid %s', (field, value) => {
    expect(
      isManualOrderDocumentAvailable(
        manualInput({ money: { ...validMoney, [field]: value } })
      )
    ).toBe(false);
  });

  it.each([
    [{ name: 'Device', quantity: 0, price: 100 }],
    [{ name: 'Device', quantity: -1, price: 100 }],
    [{ name: 'Device', quantity: 1.5, price: 100 }],
    [{ name: 'Device', quantity: 1, price: -100 }],
    [{ name: null, quantity: 1, price: 100 }],
  ])('hides unpaid orders with an invalid item (%#)', (items) => {
    expect(isManualOrderDocumentAvailable(manualInput({ items }))).toBe(false);
  });

  it('hides paid orders with invalid content the sender would skip', () => {
    const input = manualInput({
      paymentStatus: 'paid',
      total: 100,
      amountPaid: 100,
      money: { ...validMoney, shipping_fee: -5 },
    });
    expect(isManualOrderDocumentAvailable(input)).toBe(false);
    expect(isReceiptEligible(input)).toBe(false);
    expect(getCurrentDocumentKind(input)).toBe('invoice');
  });

  it('shows unpaid orders with valid content', () => {
    expect(isManualOrderDocumentAvailable(manualInput())).toBe(true);
  });
});
