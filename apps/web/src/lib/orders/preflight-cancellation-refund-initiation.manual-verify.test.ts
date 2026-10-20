import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/orders/check-cancellation-refund-provider', () => ({
  checkCancellationRefundProvider: vi.fn().mockResolvedValue([]),
}));
vi.mock('./stamp-verified-manual-paystack-refunds', () => ({
  stampVerifiedManualPaystackRefunds: vi.fn().mockResolvedValue(undefined),
}));

import { checkCancellationRefundProvider } from '@/lib/orders/check-cancellation-refund-provider';
import { preflightCancellationRefundInitiation } from './preflight-cancellation-refund-initiation';
import {
  paystackPayment,
  preflightInput,
} from './preflight-cancellation-refund-initiation.test-support';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';
import { stampVerifiedManualPaystackRefunds } from './stamp-verified-manual-paystack-refunds';

describe('preflightCancellationRefundInitiation manual verification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('verifies manual Paystack claims without initiating them', async () => {
    const manualRow = {
      amount: 100,
      currency: 'NGN',
      gateway: 'manual',
      id: 'refund-1',
      metadata: {
        method: 'paystack',
        payment_transaction_id: 'payment-1',
      },
      status: 'completed',
    };
    const result = await preflightCancellationRefundInitiation(
      preflightInput({
        manualLinkedLegIds: new Set(['payment-1']),
        mismatchedIds: new Set(['payment-1']),
        refundRows: [manualRow],
      })
    );
    expect(result.initiationTransactions).toHaveLength(0);
    expect(checkCancellationRefundProvider).toHaveBeenCalledTimes(1);
    expect(checkCancellationRefundProvider).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'ref-1' })
    );
    expect(stampVerifiedManualPaystackRefunds).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'payment-1' })
    );
    expect(result.verifiedManualPaystackLegIds).toEqual(['payment-1']);
  });
  it('verifies the claim even when another row already covers the leg', async () => {
    const result = await preflightCancellationRefundInitiation(
      preflightInput({
        manualLinkedLegIds: new Set(['payment-1']),
        mismatchedIds: new Set(['payment-1']),
        refundedPaymentIds: new Set(['payment-1']),
        refundRows: [
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'paystack',
            id: 'refund-cover',
            metadata: {
              payment_transaction_id: 'payment-1',
              provider_refund_status: 'processed',
            },
            status: 'completed',
          },
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'manual',
            id: 'refund-claim',
            metadata: {
              method: 'paystack',
              payment_transaction_id: 'payment-1',
            },
            status: 'completed',
          },
        ],
      })
    );
    // Coverage from the verified row must not swallow the unverified
    // claim: without its own proof the manager keeps reporting it
    // pending while settlement completes and no drain revisits it.
    expect(checkCancellationRefundProvider).toHaveBeenCalledTimes(1);
    expect(stampVerifiedManualPaystackRefunds).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'payment-1' })
    );
    expect(result.verifiedManualPaystackLegIds).toEqual(['payment-1']);
  });
  it('skips verification when the manual claim already carries proof', async () => {
    const result = await preflightCancellationRefundInitiation(
      preflightInput({
        manualLinkedLegIds: new Set(['payment-1']),
        refundRows: [
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'manual',
            id: 'refund-1',
            metadata: {
              method: 'paystack',
              payment_transaction_id: 'payment-1',
              provider_refund_status: 'processed',
            },
            status: 'completed',
          },
        ],
      })
    );
    expect(checkCancellationRefundProvider).not.toHaveBeenCalled();
    expect(stampVerifiedManualPaystackRefunds).not.toHaveBeenCalled();
    expect(result.verifiedManualPaystackLegIds).toEqual([]);
  });
  it('skips verification for manual legs with nothing to list', async () => {
    const cashLeg = { ...paystackPayment, gateway: 'cash', id: 'payment-2' };
    const result = await preflightCancellationRefundInitiation(
      preflightInput({
        manualLinkedLegIds: new Set(['payment-2']),
        refundRows: [
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'manual',
            id: 'refund-2',
            metadata: {
              method: 'paystack',
              payment_transaction_id: 'payment-2',
            },
            status: 'completed',
          },
        ],
        transactions: [paystackPayment, cashLeg],
      })
    );
    // The clean Paystack leg still verifies; the cash manual leg has
    // no provider reference to list, so it never joins the set.
    expect(checkCancellationRefundProvider).toHaveBeenCalledTimes(1);
    expect(result.verifiedManualPaystackLegIds).toEqual([]);
  });
  it('propagates check failures without stamping', async () => {
    vi.mocked(checkCancellationRefundProvider).mockRejectedValueOnce(
      new DeliveryUncertainError('provider mismatch')
    );
    await expect(
      preflightCancellationRefundInitiation(
        preflightInput({
          manualLinkedLegIds: new Set(['payment-1']),
          mismatchedIds: new Set(['payment-1']),
          refundRows: [
            {
              amount: 100,
              currency: 'NGN',
              gateway: 'manual',
              id: 'refund-1',
              metadata: {
                method: 'paystack',
                payment_transaction_id: 'payment-1',
              },
              status: 'completed',
            },
          ],
        })
      )
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(stampVerifiedManualPaystackRefunds).not.toHaveBeenCalled();
  });
});
