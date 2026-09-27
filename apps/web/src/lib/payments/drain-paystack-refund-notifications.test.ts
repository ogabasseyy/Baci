import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

import { drainPaystackRefundNotifications } from './drain-paystack-refund-notifications';

function database(
  eventType: string,
  paymentStatus = 'refunded',
  ledger: {
    payments?: Array<{ amount: number; gateway: string; id: string }>;
    refunds?: Array<{
      amount: number;
      currency: string;
      gateway: string;
      metadata: { payment_transaction_id: string };
    }>;
  } = {}
) {
  const order = {
    id: 'order-1',
    merchant_id: 'merchant-1',
    order_number: 'ORD-1',
    customer_email: 'buyer@example.com',
    customer_name: '<Buyer>',
    customer_id: 'customer-1',
    amount_paid: 100,
    currency: 'NGN',
    payment_status: paymentStatus,
    cancelled_at: '2026-09-27T00:00:00Z',
  };
  const merchant = {
    id: 'merchant-1',
    business_name: 'Shop',
    email: 'merchant@example.com',
    support_email: 'help@example.com',
    email_sender_name: null,
  };
  const row = {
    id: 'notification-1',
    order_id: 'order-1',
    merchant_id: 'merchant-1',
    event_type: eventType,
    claim_token: 'claim-1',
  };
  const finish = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: { id: row.id }, error: null }),
  };
  const orderQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: order, error: null }),
  };
  const merchantQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: merchant, error: null }),
  };
  const payments = ledger.payments ?? [
    { amount: 60, gateway: 'paystack', id: 'payment-1' },
  ];
  const refunds = ledger.refunds ?? [
    {
      amount: 60,
      currency: 'NGN',
      gateway: 'paystack',
      metadata: { payment_transaction_id: 'payment-1' },
    },
  ];
  const ledgerQuery = () => {
    let mode: 'payments' | 'refunds' = 'refunds';
    const query = {
      eq: vi.fn((column: string) =>
        column === 'status'
          ? Promise.resolve({
              data: mode === 'payments' ? payments : refunds,
              error: null,
            })
          : query
      ),
      select: vi.fn((columns: string) => {
        mode = columns.includes('metadata') ? 'refunds' : 'payments';
        return query;
      }),
    };
    return query;
  };
  return {
    from: vi.fn((table: string) => {
      if (table === 'orders') return orderQuery;
      if (table === 'merchants') return merchantQuery;
      if (table === 'transactions') return ledgerQuery();
      return finish;
    }),
    rpc: vi
      .fn()
      .mockResolvedValue({ data: [], error: null })
      .mockResolvedValueOnce({ data: [row], error: null }),
    finish,
  };
}

describe('Paystack refund notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendEmail.mockResolvedValue({ success: true, messageId: 'mail-1' });
  });

  it('emails the customer after the whole order is refunded', async () => {
    const db = database('processed_customer_email');
    await expect(
      drainPaystackRefundNotifications(db as never, mocks.sendEmail)
    ).resolves.toEqual({
      claimed: 1,
      sent: 1,
      failed: 0,
    });
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'buyer@example.com',
        subject: 'Refund processed for order #ORD-1',
        textContent: expect.stringContaining('10 business days'),
      })
    );
    expect(mocks.sendEmail.mock.calls[0][0].htmlContent).not.toContain(
      '<Buyer>'
    );
    expect(mocks.sendEmail.mock.calls[0][0].textContent).toContain('60');
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' })
    );
  });

  it('does not email before every payment leg is refunded', async () => {
    const db = database('processed_customer_email', 'paid');
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivery_uncertain' })
    );
  });

  it('notifies the merchant on refund completion', async () => {
    const db = database('processed_merchant_push');
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'merchant@example.com',
        subject: 'Refund processed: order #ORD-1',
      })
    );
  });

  it('records merchant delivery after an accepted email', async () => {
    const db = database('processed_merchant_push');
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'merchant@example.com',
        subject: 'Refund processed: order #ORD-1',
      })
    );
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' })
    );
  });

  it('keeps a rejected merchant email available for retry', async () => {
    const db = database('processed_merchant_push');
    mocks.sendEmail.mockResolvedValueOnce({ success: false });
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'merchant@example.com' })
    );
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('alerts the merchant when a refund fails before any leg completes', async () => {
    const db = database('failed_merchant_push', 'paid');
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(db.from).not.toHaveBeenCalledWith('transactions');
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'merchant@example.com',
        subject: 'Refund needs attention: order #ORD-1',
      })
    );
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' })
    );
  });

  it('totals every completed gateway leg in the customer email', async () => {
    const db = database('processed_customer_email', 'refunded', {
      payments: [
        { amount: 60, gateway: 'paystack', id: 'payment-1' },
        { amount: 45, gateway: 'korapay', id: 'payment-2' },
      ],
      refunds: [
        {
          amount: 60,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: { payment_transaction_id: 'payment-1' },
        },
        {
          amount: 45,
          currency: 'NGN',
          gateway: 'korapay',
          metadata: { payment_transaction_id: 'payment-2' },
        },
      ],
    });
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(mocks.sendEmail.mock.calls[0][0].textContent).toContain('105');
    expect(mocks.sendEmail.mock.calls[0][0].textContent).not.toContain(
      'Paystack'
    );
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' })
    );
  });

  it('fails the notification when a gateway leg has no linked refund', async () => {
    const db = database('processed_customer_email', 'refunded', {
      payments: [
        { amount: 60, gateway: 'paystack', id: 'payment-1' },
        { amount: 45, gateway: 'korapay', id: 'payment-2' },
      ],
      refunds: [
        {
          amount: 60,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: { payment_transaction_id: 'payment-1' },
        },
      ],
    });
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('claims the next row only after finishing the previous one', async () => {
    const db = database('processed_customer_email');
    db.rpc.mockResolvedValueOnce({
      data: [
        {
          id: 'notification-1',
          order_id: 'order-1',
          merchant_id: 'merchant-1',
          event_type: 'processed_customer_email',
          claim_token: 'claim-2',
        },
      ],
      error: null,
    });
    await expect(
      drainPaystackRefundNotifications(db as never, mocks.sendEmail)
    ).resolves.toEqual({ claimed: 2, sent: 2, failed: 0 });
    expect(db.rpc).toHaveBeenCalledWith(
      'claim_paystack_cancellation_refund_notifications_v1',
      { p_limit: 1 }
    );
    const secondClaimOrder = db.rpc.mock.invocationCallOrder[1] as number;
    const firstFinishOrder = db.finish.update.mock
      .invocationCallOrder[0] as number;
    expect(firstFinishOrder).toBeLessThan(secondClaimOrder);
  });

  it('keeps a rejected email available for retry', async () => {
    const db = database('processed_customer_email');
    mocks.sendEmail.mockResolvedValueOnce({
      success: false,
      error: 'rejected',
    });
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });
});
