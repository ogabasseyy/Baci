import { beforeEach, describe, expect, it } from 'vitest';
import {
  acceptedRefund,
  database,
  initiationOrder,
  initiationTransaction,
  mocks,
  recordPaystackCancellationRefund,
  resetRefundAuditMocks,
} from './record-paystack-cancellation-refund.test-support';

beforeEach(resetRefundAuditMocks);

describe('bank-offer refund audits', () => {
  it.each([
    '95.01',
    '95.0100',
    95.01,
  ])('replays the exact typed refund audit amount %s', async (amount) => {
    const { supabase } = database({
      conflictRow: {
        amount,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: '101',
        id: 'other-row',
        metadata: { payment_transaction_id: 'tx-1' },
        transaction_type: 'refund',
      },
      insertError: { code: '23505' },
    });

    await expect(
      recordPaystackCancellationRefund({
        order: initiationOrder,
        paystackRefund: acceptedRefund(),
        supabase,
        transaction: initiationTransaction,
        transactionAmount: '95.01',
      })
    ).resolves.toBe(101);
    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
  });
});
