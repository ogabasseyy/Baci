import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

import { drainPaystackRefundNotifications } from './drain-paystack-refund-notifications';

function database(eventType: string, paymentStatus = 'refunded') {
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
  const refundQuery = { select: vi.fn(), eq: vi.fn() };
  refundQuery.select.mockReturnValue(refundQuery);
  refundQuery.eq.mockImplementation((column: string) =>
    column === 'status'
      ? Promise.resolve({
          data: [{ amount: 60, currency: 'NGN' }],
          error: null,
        })
      : refundQuery
  );
  return {
    from: vi.fn((table: string) => {
      if (table === 'orders') return orderQuery;
      if (table === 'merchants') return merchantQuery;
      if (table === 'transactions') return refundQuery;
      return finish;
    }),
    rpc: vi.fn().mockResolvedValue({ data: [row], error: null }),
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
