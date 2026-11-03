import {
  MANUAL_ORDER_INVOICE_ONLY_ITEM_FINANCIAL_FIELDS,
  MANUAL_ORDER_RECEIPT_ITEM_FINANCIAL_FIELDS,
} from '@baci/shared/receipt';
import { describe, expect, it } from 'vitest';
import {
  isManualOrderDocumentContentValid,
  manualDocumentOrderSchema,
  manualDocumentOrderSchemaFor,
} from './manual-order-document-order';

const baseOrder = {
  id: 'order-1',
  merchant_id: 'merchant-1',
  customer_id: 'customer-1',
  recorded_by_user_id: 'user-1',
  import_job_id: null,
  external_source: null,
  order_number: '1001',
  created_at: '2026-09-30T10:00:00.000Z',
  transaction_date: null,
  invoice_issue_date: null,
  payment_due_date: null,
  payment_terms: null,
  buyer_reference: null,
  firs_irn: null,
  firs_csid: null,
  currency: 'NGN',
  total: 5000,
  subtotal: 4500,
  shipping_fee: 500,
  tax_amount: 0,
  discount_amount: 0,
  amount_paid: 5000,
  payment_status: 'paid',
  payment_method: 'transfer',
  invoice_type_code: null,
  shipping_status: 'pending',
  customer_name: 'Bassey John',
  customer_email: 'basseybjohn@yahoo.co.uk',
  customer_phone: null,
  shipping_address: null,
  order_items: [
    {
      id: 'item-1',
      name: 'Phone',
      quantity: 1,
      price: 4500,
      variant_name: null,
      condition: 'new',
      item_description: null,
    },
  ],
};

describe('manualDocumentOrderSchema', () => {
  it('accepts a manual order row with coerced totals', () => {
    const parsed = manualDocumentOrderSchema.parse({
      ...baseOrder,
      total: '5000',
    });

    expect(parsed.order_number).toBe('1001');
    expect(parsed.total).toBe(5000);
    expect(parsed.order_items).toHaveLength(1);
  });

  it('rejects negative totals and empty item quantities', () => {
    expect(() =>
      manualDocumentOrderSchema.parse({ ...baseOrder, total: -1 })
    ).toThrow();
    expect(() =>
      manualDocumentOrderSchema.parse({
        ...baseOrder,
        order_items: [{ ...baseOrder.order_items[0], quantity: 0 }],
      })
    ).toThrow();
  });

  it('fails closed on null money instead of coercing to zero', () => {
    for (const field of [
      'total',
      'subtotal',
      'shipping_fee',
      'tax_amount',
      'discount_amount',
      'amount_paid',
    ] as const) {
      expect(() =>
        manualDocumentOrderSchema.parse({ ...baseOrder, [field]: null })
      ).toThrow();
    }
    expect(() =>
      manualDocumentOrderSchema.parse({
        ...baseOrder,
        order_items: [{ ...baseOrder.order_items[0], quantity: null }],
      })
    ).toThrow();
    expect(() =>
      manualDocumentOrderSchema.parse({
        ...baseOrder,
        order_items: [{ ...baseOrder.order_items[0], price: null }],
      })
    ).toThrow();
  });

  it('rejects loose money the strict gates demote', () => {
    // z.coerce.number() alone accepts blanks, booleans, hex, padded,
    // and exponent strings the promotion gate demotes: the sender must
    // fail them too, or the emailed kind and the app badge disagree.
    for (const loose of ['', true, '0x10', ' 500', '1e3']) {
      expect(
        manualDocumentOrderSchema.safeParse({ ...baseOrder, total: loose })
          .success
      ).toBe(false);
      expect(
        isManualOrderDocumentContentValid(
          { ...baseOrder, total: loose },
          baseOrder.order_items
        )
      ).toBe(false);
    }
    expect(
      manualDocumentOrderSchema.parse({ ...baseOrder, total: '5000.00' }).total
    ).toBe(5000);
  });

  it('accepts explicit null locality from the mobile-admin edit path', () => {
    const parsed = manualDocumentOrderSchema.parse({
      ...baseOrder,
      shipping_address: {
        city: null,
        state: null,
        postal_code: null,
        postalCode: null,
      },
    });
    expect(parsed.shipping_address?.city).toBeNull();
    expect(parsed.shipping_address?.state).toBeNull();
  });

  it('accepts explicit null address lines like any other null key', () => {
    // Every key renders null as empty: rejecting null on one line while
    // accepting it on locality would skip a valid document.
    const parsed = manualDocumentOrderSchema.parse({
      ...baseOrder,
      shipping_address: {
        address: null,
        address_line1: null,
        address_line2: null,
        country: null,
      },
    });
    expect(parsed.shipping_address?.address_line1).toBeNull();
    expect(parsed.shipping_address?.country).toBeNull();
  });

  it('keeps the archive gate in lockstep with the sender on item finances', () => {
    const money = {
      total: 5000,
      subtotal: 4500,
      shipping_fee: 500,
      tax_amount: 0,
      discount_amount: 0,
      amount_paid: 5000,
      currency: 'NGN',
    };
    const item = { name: 'Phone', quantity: 1, price: 4500 };
    expect(isManualOrderDocumentContentValid(money, [item])).toBe(true);
    for (const field of MANUAL_ORDER_RECEIPT_ITEM_FINANCIAL_FIELDS) {
      // The sender rejects the negative value, so the archive must not
      // advertise the document either.
      expect(
        manualDocumentOrderSchema.safeParse({
          ...baseOrder,
          order_items: [{ ...baseOrder.order_items[0], [field]: -1 }],
        }).success
      ).toBe(false);
      expect(
        isManualOrderDocumentContentValid(money, [{ ...item, [field]: -1 }])
      ).toBe(false);
      // Null stays valid on both sides.
      expect(
        isManualOrderDocumentContentValid(money, [{ ...item, [field]: null }])
      ).toBe(true);
    }
    for (const field of MANUAL_ORDER_INVOICE_ONLY_ITEM_FINANCIAL_FIELDS) {
      const order = {
        ...baseOrder,
        order_items: [{ ...baseOrder.order_items[0], [field]: -1 }],
      };
      // Receipts print no item VAT: sender and archive accept the
      // negative for receipts while invoices still reject on both.
      expect(
        manualDocumentOrderSchemaFor('receipt').safeParse(order).success
      ).toBe(true);
      expect(
        manualDocumentOrderSchemaFor('invoice').safeParse(order).success
      ).toBe(false);
      expect(
        isManualOrderDocumentContentValid(
          money,
          [{ ...item, [field]: -1 }],
          false
        )
      ).toBe(true);
      expect(
        isManualOrderDocumentContentValid(
          money,
          [{ ...item, [field]: -1 }],
          true
        )
      ).toBe(false);
      // Non-decimal VAT still fails closed for both kinds.
      const garbage = {
        ...baseOrder,
        order_items: [{ ...baseOrder.order_items[0], [field]: 'abc' }],
      };
      expect(
        manualDocumentOrderSchemaFor('receipt').safeParse(garbage).success
      ).toBe(false);
      expect(
        isManualOrderDocumentContentValid(
          money,
          [{ ...item, [field]: 'abc' }],
          false
        )
      ).toBe(false);
    }
  });

  it('requires an exact three-letter currency code', () => {
    for (const currency of ['NGN', 'usd', null, undefined]) {
      expect(
        manualDocumentOrderSchema.parse({ ...baseOrder, currency }).currency
      ).toBe(currency);
    }
    for (const currency of ['', 'NG', 'NAIRA', ' NGN', 'NGN ', 'N-G']) {
      expect(() =>
        manualDocumentOrderSchema.parse({ ...baseOrder, currency })
      ).toThrow();
    }
  });
});
