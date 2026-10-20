import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/orders/check-cancellation-refund-provider', () => ({
  checkCancellationRefundProvider: vi.fn().mockResolvedValue([]),
}));

import { checkCancellationRefundProvider } from '@/lib/orders/check-cancellation-refund-provider';
import { preflightCancellationRefundInitiation } from './preflight-cancellation-refund-initiation';
import {
  paystackPayment,
  preflightInput,
} from './preflight-cancellation-refund-initiation.test-support';

describe('preflightCancellationRefundInitiation initiation set', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the initiation set and guards each Paystack leg', async () => {
    const first = { ...paystackPayment, amount: 60 };
    const other = {
      ...paystackPayment,
      amount: 40,
      id: 'payment-2',
      gateway_reference: 'ref-2',
    };
    const result = await preflightCancellationRefundInitiation(
      preflightInput({ transactions: [first, other] })
    );
    expect(result.initiationTransactions).toHaveLength(2);
    expect(result.auditBlockedTransactions).toHaveLength(0);
    expect(checkCancellationRefundProvider).toHaveBeenCalledTimes(2);
    expect(checkCancellationRefundProvider).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'ref-1' })
    );
  });

  it('withholds mismatched and audit-blocked legs from initiation', async () => {
    const result = await preflightCancellationRefundInitiation(
      preflightInput({
        auditBlockedLegIds: new Set(['payment-2']),
        mismatchedIds: new Set(['payment-3']),
        transactions: [
          paystackPayment,
          { ...paystackPayment, id: 'payment-2', gateway_reference: 'ref-2' },
          { ...paystackPayment, id: 'payment-3', gateway_reference: 'ref-3' },
        ],
      })
    );
    expect(result.initiationTransactions.map((leg) => leg.id)).toEqual([
      'payment-1',
    ]);
    expect(result.auditBlockedTransactions.map((leg) => leg.id)).toEqual([
      'payment-2',
    ]);
  });

  it('withholds manual-linked legs from initiation without review', async () => {
    const result = await preflightCancellationRefundInitiation(
      preflightInput({
        manualLinkedLegIds: new Set(['payment-1']),
      })
    );
    expect(result.initiationTransactions).toHaveLength(0);
    expect(checkCancellationRefundProvider).not.toHaveBeenCalled();
  });
});
