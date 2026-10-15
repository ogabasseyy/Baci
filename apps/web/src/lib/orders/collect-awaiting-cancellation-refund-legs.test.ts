import { describe, expect, it } from 'vitest';
import { collectAwaitingCancellationRefundLegs } from './collect-awaiting-cancellation-refund-legs';

const linkedPaymentId = (row: { metadata: unknown }): string | null => {
  const claimed = (row.metadata as { payment_transaction_id?: unknown } | null)
    ?.payment_transaction_id;
  return typeof claimed === 'string' ? claimed : null;
};

const linked = (paymentId: string) => ({
  payment_transaction_id: paymentId,
});

describe('collectAwaitingCancellationRefundLegs', () => {
  it('waits for provider-accepted rows and reviews the rest', () => {
    const { awaitingRefundPaymentIds, reviewRefundPaymentIds } =
      collectAwaitingCancellationRefundLegs({
        linkedPaymentId,
        refundRows: [
          {
            gateway_reference: '42',
            metadata: linked('payment-1'),
            status: 'refund_pending',
          },
          {
            gateway_reference: 'draft',
            metadata: linked('payment-2'),
            status: 'refund_pending',
          },
          {
            gateway_reference: '43',
            metadata: linked('payment-3'),
            status: 'failed',
          },
        ],
      });
    expect([...awaitingRefundPaymentIds]).toEqual(['payment-1']);
    expect([...reviewRefundPaymentIds]).toEqual(['payment-2', 'payment-3']);
  });

  it('skips terminal and unlinked rows', () => {
    const { awaitingRefundPaymentIds, reviewRefundPaymentIds } =
      collectAwaitingCancellationRefundLegs({
        linkedPaymentId,
        refundRows: [
          {
            gateway_reference: '44',
            metadata: linked('payment-1'),
            status: 'completed',
          },
          {
            gateway_reference: '45',
            metadata: linked('payment-2'),
            status: 'refunded',
          },
          { gateway_reference: '46', metadata: {}, status: 'failed' },
          {
            gateway_reference: '47',
            metadata: linked('payment-4'),
            status: 'failed',
          },
        ],
      });
    expect([...awaitingRefundPaymentIds]).toEqual([]);
    expect([...reviewRefundPaymentIds]).toEqual(['payment-4']);
  });

  it('handles a null row list', () => {
    const { awaitingRefundPaymentIds, reviewRefundPaymentIds } =
      collectAwaitingCancellationRefundLegs({
        linkedPaymentId,
        refundRows: null,
      });
    expect(awaitingRefundPaymentIds.size).toBe(0);
    expect(reviewRefundPaymentIds.size).toBe(0);
  });
});
