import { describe, expect, it } from 'vitest';
import { manualDocumentClaimSchema } from './manual-order-document-claim';

const snapshot = {
  order_total: 5000,
  order_amount_paid: 5000,
  order_item_count: 1,
  order_payment_status: 'paid',
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
