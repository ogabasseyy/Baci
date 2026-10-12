import { describe, expect, it, vi } from 'vitest';
import { attemptMerchantRefundPush } from './attempt-merchant-refund-push';
import { REFUND_NOTIFICATION_DELIVERY_DEADLINE } from './await-refund-notification-deadline';
import type { MerchantRefundPushSender } from './deliver-claimed-refund-notification';

function args(sendMerchantPush: MerchantRefundPushSender) {
  return {
    body: 'body',
    completed: true,
    merchantId: 'merchant-1',
    orderId: 'order-1',
    orderNumber: 'ORD-1',
    sendMerchantPush,
    title: 'title',
  };
}

describe('attemptMerchantRefundPush', () => {
  it('reports sent when a push is delivered', async () => {
    const sendMerchantPush = vi
      .fn<MerchantRefundPushSender>()
      .mockResolvedValue({ errors: [], failed: 0, sent: 1 });

    await expect(
      attemptMerchantRefundPush(args(sendMerchantPush))
    ).resolves.toEqual({ lastError: null, outcome: 'sent' });
    expect(sendMerchantPush).toHaveBeenCalledWith(
      'merchant-1',
      'title',
      'body',
      expect.objectContaining({
        order_id: 'order-1',
        type: 'paystack_refund_processed',
      }),
      'payments'
    );
  });

  it('reports failed when the sender rejects before dispatch', async () => {
    const sendMerchantPush = vi
      .fn<MerchantRefundPushSender>()
      .mockRejectedValue(new Error('admin client unavailable'));

    await expect(
      attemptMerchantRefundPush(args(sendMerchantPush))
    ).resolves.toEqual({
      lastError: 'admin client unavailable',
      outcome: 'failed',
    });
  });

  it('reports failed when the sender throws synchronously', async () => {
    const sendMerchantPush = vi.fn<MerchantRefundPushSender>(() => {
      throw new Error('sync setup failure');
    });

    await expect(
      attemptMerchantRefundPush(args(sendMerchantPush))
    ).resolves.toEqual({ lastError: 'sync setup failure', outcome: 'failed' });
  });

  it('reports failed on a definite non-delivery result', async () => {
    const sendMerchantPush = vi
      .fn<MerchantRefundPushSender>()
      .mockResolvedValue({
        errors: ['no tokens'],
        failed: 2,
        sent: 0,
      });

    await expect(
      attemptMerchantRefundPush(args(sendMerchantPush))
    ).resolves.toEqual({
      lastError: 'refund_merchant_push_failed',
      outcome: 'failed',
    });
  });

  it('reports uncertain on an unknown sender result', async () => {
    const sendMerchantPush = vi
      .fn<MerchantRefundPushSender>()
      .mockResolvedValue({
        deliveryOutcome: 'unknown',
        errors: [],
        failed: 0,
        sent: 0,
      });

    await expect(
      attemptMerchantRefundPush(args(sendMerchantPush))
    ).resolves.toEqual({
      lastError: 'refund_merchant_push_uncertain',
      outcome: 'delivery_uncertain',
    });
  });

  it('reports uncertain on a partial delivery', async () => {
    const sendMerchantPush = vi
      .fn<MerchantRefundPushSender>()
      .mockResolvedValue({
        errors: [],
        failed: 1,
        sent: 1,
      });

    await expect(
      attemptMerchantRefundPush(args(sendMerchantPush))
    ).resolves.toEqual({
      lastError: 'refund_merchant_push_uncertain',
      outcome: 'delivery_uncertain',
    });
  });

  it('reports uncertain when the deadline fires mid-dispatch', async () => {
    const sendMerchantPush = vi
      .fn<MerchantRefundPushSender>()
      .mockReturnValue(new Promise(() => {}));

    await expect(
      attemptMerchantRefundPush({
        ...args(sendMerchantPush),
        deadlineMs: Date.now() + 50,
      })
    ).resolves.toEqual({
      lastError: REFUND_NOTIFICATION_DELIVERY_DEADLINE,
      outcome: 'delivery_uncertain',
    });
  });
});
