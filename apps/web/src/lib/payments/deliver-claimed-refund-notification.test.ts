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
    attempts: 1,
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
    chain.in = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue(result);
    // List-query terminal for the refund-gateway probe: a terminal
    // provider row preserves the pre-existing copy in these tests.
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
    chain.then = (resolve: (value: unknown) => void) =>
      Promise.resolve(
        table === 'transactions'
          ? {
              data: [{ gateway: 'paystack', status: 'completed' }],
              error: null,
            }
          : result
      ).then(resolve);
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

  it('retries a customer email throw when dispatch never started', async () => {
    const { supabase } = buildSupabase();
    const sendEmail = vi
      .fn()
      .mockRejectedValue(new Error('sender resolution failed'));

    await expect(
      deliverClaimedRefundNotification({
        row: claimed('processed_customer_email'),
        sendEmail,
        supabase,
      })
    ).resolves.toEqual({
      lastError: 'sender resolution failed',
      outcome: 'failed',
    });
  });

  it('collapses a customer email throw to uncertain once dispatched', async () => {
    const { supabase } = buildSupabase();
    const sendEmail = vi.fn().mockImplementation(async (message: never) => {
      const { beforeTransportDispatch } = message as unknown as {
        beforeTransportDispatch?: () => Promise<void>;
      };
      await beforeTransportDispatch?.();
      throw new Error('smtp down');
    });

    await expect(
      deliverClaimedRefundNotification({
        row: claimed('processed_customer_email'),
        sendEmail: sendEmail as never,
        supabase,
      })
    ).resolves.toEqual({
      lastError: 'smtp down',
      outcome: 'delivery_uncertain',
    });
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
});
