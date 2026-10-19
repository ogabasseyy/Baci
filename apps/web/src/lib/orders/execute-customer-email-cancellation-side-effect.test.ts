import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildOrderCancellationEmailMessage: vi.fn(),
}));

vi.mock('./build-order-cancellation-email-message', () => ({
  buildOrderCancellationEmailMessage: mocks.buildOrderCancellationEmailMessage,
}));

import { executeCustomerEmailCancellationSideEffect } from './execute-customer-email-cancellation-side-effect';
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildOrderCancellationEmailMessage.mockReturnValue({
    htmlContent: '<p>cancelled</p>',
    subject: 'Order ORD-1 cancelled',
    textContent: 'cancelled',
    to: 'buyer@example.com',
  });
});

describe('executeCustomerEmailCancellationSideEffect', () => {
  it('sends the cancellation email and returns the message id', async () => {
    const sendCancellationEmail = vi
      .fn()
      .mockResolvedValue({ messageId: 'msg-1', success: true });

    await expect(
      executeCustomerEmailCancellationSideEffect({
        merchant: merchant as never,
        order: order as never,
        reason: 'out of stock',
        sendCancellationEmail: sendCancellationEmail as never,
      })
    ).resolves.toEqual({ messageId: 'msg-1' });

    expect(mocks.buildOrderCancellationEmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'out of stock', refundAmount: 100 })
    );
    expect(sendCancellationEmail).toHaveBeenCalledTimes(1);
    expect(sendCancellationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        maxAttemptsPerSender: 1,
        to: 'buyer@example.com',
      })
    );
  });

  it('throws when no cancellation email sender is provided', async () => {
    await expect(
      executeCustomerEmailCancellationSideEffect({
        merchant: merchant as never,
        order: order as never,
      })
    ).rejects.toThrow('Cancellation email sender is required');
  });

  it('refuses the send when the phase budget cannot fit one attempt', async () => {
    const sendCancellationEmail = vi.fn();

    await expect(
      executeCustomerEmailCancellationSideEffect({
        deadlineMs: Date.now() + 5_000,
        merchant: merchant as never,
        order: order as never,
        sendCancellationEmail: sendCancellationEmail as never,
      })
    ).rejects.toThrow('refund_notification_deadline_before_send');
    expect(sendCancellationEmail).not.toHaveBeenCalled();
  });

  it('throws the sender error when the email is rejected', async () => {
    const sendCancellationEmail = vi
      .fn()
      .mockResolvedValue({ error: 'mailbox full', success: false });

    await expect(
      executeCustomerEmailCancellationSideEffect({
        merchant: merchant as never,
        order: order as never,
        sendCancellationEmail: sendCancellationEmail as never,
      })
    ).rejects.toThrow('mailbox full');
  });

  it('marks an unknown delivery outcome as delivery uncertain', async () => {
    const sendCancellationEmail = vi.fn().mockResolvedValue({
      deliveryOutcome: 'unknown',
      error: 'connection reset',
      success: false,
    });

    const error = await executeCustomerEmailCancellationSideEffect({
      merchant: merchant as never,
      order: order as never,
      sendCancellationEmail: sendCancellationEmail as never,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DeliveryUncertainError);
    expect((error as Error).message).toBe('connection reset');
  });

  it('marks a thrown send as delivery uncertain without auto-retrying', async () => {
    const sendCancellationEmail = vi
      .fn()
      .mockRejectedValue(new Error('socket hangup'));

    const error = await executeCustomerEmailCancellationSideEffect({
      merchant: merchant as never,
      order: order as never,
      sendCancellationEmail: sendCancellationEmail as never,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DeliveryUncertainError);
    expect((error as Error).message).toBe(
      'cancellation_email_send_failed: socket hangup'
    );
    expect(sendCancellationEmail).toHaveBeenCalledTimes(1);
  });
});
