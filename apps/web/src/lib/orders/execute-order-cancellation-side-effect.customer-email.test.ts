import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/zeptomail', () => ({ sendEmail: mocks.sendEmail }));
vi.mock('@/lib/orders/build-order-cancellation-email-message', () => ({
  buildOrderCancellationEmailMessage: vi.fn(() => ({
    to: 'buyer@example.com',
  })),
}));

import { executeOrderCancellationSideEffect } from './execute-order-cancellation-side-effect';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

const merchant = {
  business_name: 'Store',
  cac_rc_number: null,
  email: 'store@example.com',
  email_sender_name: null,
  id: 'merchant-1',
  slug: 'store',
  support_email: null,
  tax_identification_number: null,
};
const order = {
  amount_paid: 100,
  currency: 'NGN',
  customer_email: 'buyer@example.com',
  customer_id: null,
  customer_name: 'Buyer',
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_items: [],
  order_number: 'ORD-1',
  payment_status: 'paid',
  total: 100,
};

describe('executeOrderCancellationSideEffect customer email', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the cancellation email', async () => {
    mocks.sendEmail.mockResolvedValue({ success: true, messageId: 'msg-1' });

    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        sendCancellationEmail: mocks.sendEmail,
        step: 'customer_email',
        supabase: { from: vi.fn() } as never,
      })
    ).resolves.toEqual({ messageId: 'msg-1' });
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.not.objectContaining({ signal: expect.anything() })
    );
  });

  it('refuses the cancellation email when the cron budget is exhausted', async () => {
    await expect(
      executeOrderCancellationSideEffect({
        deadlineMs: Date.now() + 5_000,
        merchant,
        order,
        sendCancellationEmail: mocks.sendEmail,
        step: 'customer_email',
        supabase: { from: vi.fn() } as never,
      })
    ).rejects.toThrow('refund_notification_deadline_before_send');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('propagates the cron deadline into the email transport', async () => {
    mocks.sendEmail.mockResolvedValue({ success: true, messageId: 'msg-1' });

    await executeOrderCancellationSideEffect({
      deadlineMs: Date.now() + 60_000,
      merchant,
      order,
      sendCancellationEmail: mocks.sendEmail,
      step: 'customer_email',
      supabase: { from: vi.fn() } as never,
    });

    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('treats a timed-out cancellation email as delivery-uncertain', async () => {
    vi.useFakeTimers();
    try {
      mocks.sendEmail.mockReturnValue(new Promise(() => {}));

      const outcome = executeOrderCancellationSideEffect({
        deadlineMs: Date.now() + 30_000,
        merchant,
        order,
        sendCancellationEmail: mocks.sendEmail,
        step: 'customer_email',
        supabase: { from: vi.fn() } as never,
      });
      const assertion = expect(outcome).rejects.toBeInstanceOf(
        DeliveryUncertainError
      );
      await vi.advanceTimersByTimeAsync(25_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a thrown cancellation email send as delivery-uncertain', async () => {
    mocks.sendEmail.mockRejectedValue(new Error('socket closed'));

    const error = await executeOrderCancellationSideEffect({
      merchant,
      order,
      sendCancellationEmail: mocks.sendEmail,
      step: 'customer_email',
      supabase: { from: vi.fn() } as never,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DeliveryUncertainError);
    expect((error as Error).message).toContain('socket closed');
  });

  it('treats an unknown-outcome email result as delivery-uncertain', async () => {
    mocks.sendEmail.mockResolvedValue({
      deliveryOutcome: 'unknown',
      error: 'outcome unknown',
      success: false,
    });

    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        sendCancellationEmail: mocks.sendEmail,
        step: 'customer_email',
        supabase: { from: vi.fn() } as never,
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
  });

  it('retries a definitively rejected cancellation email', async () => {
    mocks.sendEmail.mockResolvedValue({
      error: 'rejected',
      success: false,
    });

    const error = await executeOrderCancellationSideEffect({
      merchant,
      order,
      sendCancellationEmail: mocks.sendEmail,
      step: 'customer_email',
      supabase: { from: vi.fn() } as never,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DeliveryUncertainError);
    expect((error as Error).message).toBe('rejected');
  });
});
