import { describe, expect, it } from 'vitest';
import {
  assertManualDocumentClaimMatchesOrder,
  manualDocumentClaimSchema,
} from './manual-order-document-claim';

const snapshot = {
  order_total: 5000,
  order_amount_paid: 5000,
  order_item_count: 1,
  order_payment_status: 'paid',
};

const prepared = {
  status: 'created' as const,
  claim_id: 'claim-1',
  customer_id: 'customer-1',
  customer_email: 'BasseyBJohn@Yahoo.CO.UK',
  ...snapshot,
};

const order = {
  customer_id: 'customer-1',
  total: 5000,
  amount_paid: 5000,
  order_items: [{ id: 'item-1' }],
  payment_status: 'paid',
};

describe('manualDocumentClaimSchema', () => {
  it('accepts created and skipped claim outcomes', () => {
    expect(
      manualDocumentClaimSchema.parse({
        status: 'created',
        claim_id: 'claim-1',
        customer_id: 'customer-1',
        customer_email: 'basseybjohn@yahoo.co.uk',
        ...snapshot,
      })
    ).toMatchObject({ status: 'created' });
    expect(manualDocumentClaimSchema.parse({ status: 'skipped' })).toEqual({
      status: 'skipped',
    });
  });

  it('rejects created claims without a customer binding', () => {
    expect(() =>
      manualDocumentClaimSchema.parse({
        status: 'created',
        claim_id: '',
        customer_id: 'customer-1',
        customer_email: 'basseybjohn@yahoo.co.uk',
        ...snapshot,
      })
    ).toThrow();
  });

  it('requires the validated order snapshot on created claims', () => {
    expect(() =>
      manualDocumentClaimSchema.parse({
        status: 'created',
        claim_id: 'claim-1',
        customer_id: 'customer-1',
        customer_email: 'basseybjohn@yahoo.co.uk',
      })
    ).toThrow();
  });
});

describe('assertManualDocumentClaimMatchesOrder', () => {
  it('accepts a claim that matches the rendered order', () => {
    expect(() =>
      assertManualDocumentClaimMatchesOrder(
        prepared,
        order,
        'basseybjohn@yahoo.co.uk'
      )
    ).not.toThrow();
  });

  it('rejects recipient drift', () => {
    expect(() =>
      assertManualDocumentClaimMatchesOrder(prepared, order, 'ada@example.com')
    ).toThrow('Manual document recipient changed');
    expect(() =>
      assertManualDocumentClaimMatchesOrder(
        { ...prepared, customer_id: 'customer-2' },
        order,
        'basseybjohn@yahoo.co.uk'
      )
    ).toThrow('Manual document recipient changed');
  });

  it('rejects orders edited after the sender read', () => {
    expect(() =>
      assertManualDocumentClaimMatchesOrder(
        prepared,
        { ...order, total: 6000 },
        'basseybjohn@yahoo.co.uk'
      )
    ).toThrow('Manual document order changed during preparation');
    expect(() =>
      assertManualDocumentClaimMatchesOrder(
        prepared,
        { ...order, order_items: [] },
        'basseybjohn@yahoo.co.uk'
      )
    ).toThrow('Manual document order changed during preparation');
  });
});
