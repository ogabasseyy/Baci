import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/orders/check-cancellation-refund-provider', () => ({
  checkCancellationRefundProvider: vi.fn().mockResolvedValue([]),
}));

import { checkCancellationRefundProvider } from '@/lib/orders/check-cancellation-refund-provider';
import { preflightCancellationRefundInitiation } from './preflight-cancellation-refund-initiation';
import {
  merchant,
  order,
  paystackPayment,
  preflightInput,
  preflightSupabase,
} from './preflight-cancellation-refund-initiation.test-support';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

describe('preflightCancellationRefundInitiation provider guards', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ignores settled foreign-currency legs but guards outstanding ones', async () => {
    const client = preflightSupabase();
    // A fully refunded USD leg plus an outstanding NGN leg proceeds, and
    // the provider guard runs for the outstanding leg only.
    await expect(
      preflightCancellationRefundInitiation(
        preflightInput({
          refundedPaymentIds: new Set(['payment-usd']),
          supabase: client as never,
          transactions: [
            {
              ...paystackPayment,
              currency: 'USD',
              gateway_reference: 'ref-usd',
              id: 'payment-usd',
            },
            paystackPayment,
          ],
        })
      )
    ).resolves.toBeDefined();
    expect(checkCancellationRefundProvider).toHaveBeenCalledTimes(1);
    expect(checkCancellationRefundProvider).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'ref-1' })
    );
    // An outstanding USD leg quarantines instead.
    await expect(
      preflightCancellationRefundInitiation(
        preflightInput({
          supabase: client as never,
          transactions: [{ ...paystackPayment, currency: 'USD' }],
        })
      )
    ).rejects.toThrow('Payment currency requires review before refund');
    expect(client.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        reason: 'Payment currency requires review before refund',
      })
    );
    expect(checkCancellationRefundProvider).toHaveBeenCalledTimes(1);
  });

  it('accepts legacy casing but rejects missing leg currencies', async () => {
    await expect(
      preflightCancellationRefundInitiation(
        preflightInput({
          transactions: [{ ...paystackPayment, currency: ' ngn ' }],
        })
      )
    ).resolves.toBeDefined();
    await expect(
      preflightCancellationRefundInitiation(
        preflightInput({
          transactions: [{ ...paystackPayment, currency: null }],
        })
      )
    ).rejects.toThrow('Payment currency requires review before refund');
  });
  it('defaults a legacy blank order currency to NGN like the manager', async () => {
    for (const currency of [null, '', '   ']) {
      await expect(
        preflightCancellationRefundInitiation(
          preflightInput({
            order: { ...order, currency } as never,
          })
        )
      ).resolves.toBeDefined();
    }
  });

  it('derives the cap from funded legs when amount paid is null', async () => {
    const client = preflightSupabase();
    // A legacy null paid total reconstructs from the outstanding
    // leg instead of zeroing the cap and quarantining the retry.
    await expect(
      preflightCancellationRefundInitiation(
        preflightInput({
          order: { ...order, amount_paid: null } as never,
          supabase: client as never,
        })
      )
    ).resolves.toBeDefined();
    expect(client.insert).not.toHaveBeenCalled();
    expect(checkCancellationRefundProvider).toHaveBeenCalled();
  });

  it('derives the cap from funded legs when amount paid is zero', async () => {
    const client = preflightSupabase();
    // A never-stamped zero reconstructs like null (SQL derives on
    // NULLIF-0): the worker and the manager must agree, or the
    // dashboard shows a refundable balance the worker never spends.
    await expect(
      preflightCancellationRefundInitiation(
        preflightInput({
          order: { ...order, amount_paid: 0 } as never,
          supabase: client as never,
        })
      )
    ).resolves.toBeDefined();
    expect(client.insert).not.toHaveBeenCalled();
    expect(checkCancellationRefundProvider).toHaveBeenCalled();
  });

  it('quarantines overfunded ledgers instead of retrying them', async () => {
    const client = preflightSupabase();
    await expect(
      preflightCancellationRefundInitiation(
        preflightInput({
          supabase: client as never,
          transactions: [{ ...paystackPayment, amount: 101 }],
        })
      )
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(client.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        merchant_id: merchant.id,
        order_id: order.id,
      })
    );
    expect(checkCancellationRefundProvider).not.toHaveBeenCalled();
  });

  it('skips the provider guard for non-Paystack and reference-less legs', async () => {
    await preflightCancellationRefundInitiation(
      preflightInput({
        transactions: [
          { ...paystackPayment, amount: 60, gateway: 'korapay' },
          {
            ...paystackPayment,
            amount: 40,
            id: 'payment-2',
            gateway_reference: null,
          },
        ],
      })
    );
    expect(checkCancellationRefundProvider).not.toHaveBeenCalled();
  });
});
