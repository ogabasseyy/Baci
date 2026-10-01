import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refundNotificationLedgerAmount: vi.fn(),
  resolveContradictoryRefundFailure: vi.fn(),
}));

vi.mock('./refund-notification-ledger', () => ({
  refundNotificationLedgerAmount: mocks.refundNotificationLedgerAmount,
}));
vi.mock('./resolve-contradictory-refund-failure', () => ({
  resolveContradictoryRefundFailure: mocks.resolveContradictoryRefundFailure,
}));

import {
  type ClaimedRefundNotification,
  deliverClaimedRefundNotification,
} from './deliver-claimed-refund-notification';

const order = {
  cancelled_at: '2026-01-01T00:00:00.000Z',
  currency: 'NGN',
  customer_email: 'buyer@example.com',
  customer_id: null,
  customer_name: 'Buyer',
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_number: 'ORD-1',
  payment_status: 'refunded',
};

const merchant = {
  business_name: 'Store',
  email: 'store@example.com',
  email_sender_name: null,
  id: 'merchant-1',
  support_email: null,
};

function claimed(
  eventType: ClaimedRefundNotification['event_type']
): ClaimedRefundNotification {
  return {
    claim_token: 'claim-1',
    created_at: '2026-01-01T00:00:00.000Z',
    event_type: eventType,
    generation: 1,
    id: 'notif-1',
    merchant_id: 'merchant-1',
    order_id: 'order-1',
  };
}

function buildSupabase({
  merchantData = merchant,
  merchantError = null,
  orderData = order,
  orderError = null,
}: {
  merchantData?: unknown;
  merchantError?: unknown;
  orderData?: unknown;
  orderError?: unknown;
} = {}) {
  const from = vi.fn((table: string) => {
    const result =
      table === 'orders'
        ? { data: orderData, error: orderError }
        : { data: merchantData, error: merchantError };
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue(result);
    return chain;
  });
  return { from, supabase: { from } as never };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.refundNotificationLedgerAmount.mockResolvedValue('NGN 100.00');
  mocks.resolveContradictoryRefundFailure.mockResolvedValue(false);
});

describe('deliverClaimedRefundNotification', () => {
  it('sends the processed customer email and reports sent', async () => {
    const { supabase } = buildSupabase();
    const sendEmail = vi.fn().mockResolvedValue({ success: true });

    await expect(
      deliverClaimedRefundNotification({
        row: claimed('processed_customer_email'),
        sendEmail,
        supabase,
      })
    ).resolves.toEqual({ lastError: null, outcome: 'sent' });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        auditContext: expect.objectContaining({
          merchantId: 'merchant-1',
          orderId: 'order-1',
        }),
        emailType: 'orders',
        subject: 'Refund processed for order #ORD-1',
        to: 'buyer@example.com',
      })
    );
  });

  it('collapses an order lookup failure to failed without sending', async () => {
    const { supabase } = buildSupabase({
      orderData: null,
      orderError: new Error('db down'),
    });
    const sendEmail = vi.fn();

    await expect(
      deliverClaimedRefundNotification({
        row: claimed('processed_customer_email'),
        sendEmail,
        supabase,
      })
    ).resolves.toEqual({
      lastError: 'refund_notification_order_lookup_failed',
      outcome: 'failed',
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('holds a processed event for review when the refund is not complete', async () => {
    const { supabase } = buildSupabase({
      orderData: { ...order, payment_status: 'paid' },
    });
    const sendEmail = vi.fn();

    await expect(
      deliverClaimedRefundNotification({
        row: claimed('processed_customer_email'),
        sendEmail,
        supabase,
      })
    ).resolves.toEqual({
      lastError: 'order_refund_not_complete',
      outcome: 'delivery_uncertain',
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('reports failed when the customer email is rejected', async () => {
    const { supabase } = buildSupabase();
    const sendEmail = vi.fn().mockResolvedValue({ success: false });

    await expect(
      deliverClaimedRefundNotification({
        row: claimed('processed_customer_email'),
        sendEmail,
        supabase,
      })
    ).resolves.toEqual({
      lastError: 'refund_customer_email_rejected',
      outcome: 'failed',
    });
  });

  it('delivers a processed merchant push without email', async () => {
    const { supabase } = buildSupabase();
    const sendEmail = vi.fn();
    const sendMerchantPush = vi
      .fn()
      .mockResolvedValue({ errors: [], failed: 0, sent: 1 });

    await expect(
      deliverClaimedRefundNotification({
        row: claimed('processed_merchant_push'),
        sendEmail,
        sendMerchantPush,
        supabase,
      })
    ).resolves.toEqual({ lastError: null, outcome: 'sent' });

    expect(sendMerchantPush).toHaveBeenCalledWith(
      'merchant-1',
      'Refund processed',
      expect.stringContaining('order #ORD-1'),
      expect.objectContaining({
        order_id: 'order-1',
        type: 'paystack_refund_processed',
      }),
      'payments'
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('falls back to email when push dispatch never starts', async () => {
    const { supabase } = buildSupabase();
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    const sendMerchantPush = vi
      .fn()
      .mockRejectedValue(new Error('admin client unavailable'));

    await expect(
      deliverClaimedRefundNotification({
        row: claimed('processed_merchant_push'),
        sendEmail,
        sendMerchantPush,
        supabase,
      })
    ).resolves.toEqual({ lastError: null, outcome: 'sent' });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ emailType: 'notifications' })
    );
  });

  it('reports failed when push fails and the email fallback is rejected', async () => {
    const { supabase } = buildSupabase();
    const sendEmail = vi.fn().mockResolvedValue({ success: false });
    const sendMerchantPush = vi
      .fn()
      .mockRejectedValue(new Error('admin client unavailable'));

    await expect(
      deliverClaimedRefundNotification({
        row: claimed('processed_merchant_push'),
        sendEmail,
        sendMerchantPush,
        supabase,
      })
    ).resolves.toEqual({
      lastError: 'refund_merchant_email_rejected',
      outcome: 'failed',
    });
  });

  it('skips the email fallback on an unknown push result', async () => {
    const { supabase } = buildSupabase();
    const sendEmail = vi.fn();
    const sendMerchantPush = vi.fn().mockResolvedValue({
      deliveryOutcome: 'unknown',
      errors: [],
      failed: 0,
      sent: 0,
    });

    await expect(
      deliverClaimedRefundNotification({
        row: claimed('processed_merchant_push'),
        sendEmail,
        sendMerchantPush,
        supabase,
      })
    ).resolves.toEqual({
      lastError: 'refund_merchant_push_uncertain',
      outcome: 'delivery_uncertain',
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('treats a superseded contradictory failure as sent', async () => {
    const { supabase } = buildSupabase();
    mocks.resolveContradictoryRefundFailure.mockResolvedValue(true);
    const sendEmail = vi.fn();
    const sendMerchantPush = vi.fn();

    await expect(
      deliverClaimedRefundNotification({
        row: claimed('failed_merchant_push'),
        sendEmail,
        sendMerchantPush,
        supabase,
      })
    ).resolves.toEqual({ lastError: null, outcome: 'sent' });

    expect(sendMerchantPush).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
