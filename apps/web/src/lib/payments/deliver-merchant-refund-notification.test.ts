import { beforeEach, describe, expect, it, vi } from 'vitest';
import { zeptomailSendAdmissionBudgetMs } from '@/lib/zeptomail-send-budget';

const mocks = vi.hoisted(() => ({
  resolveContradictoryRefundFailure: vi.fn(),
}));

vi.mock('./resolve-contradictory-refund-failure', () => ({
  resolveContradictoryRefundFailure: mocks.resolveContradictoryRefundFailure,
}));

import type {
  ClaimedRefundNotification,
  MerchantRefundPushSender,
  RefundEmailSender,
  RefundNotificationMerchant,
  RefundNotificationOrder,
} from './deliver-claimed-refund-notification';
import { deliverMerchantRefundNotification } from './deliver-merchant-refund-notification';

const order: RefundNotificationOrder = {
  cancelled_at: '2026-01-01T00:00:00.000Z',
  currency: 'NGN',
  customer_email: 'buyer@example.com',
  customer_id: null,
  customer_name: 'Buyer',
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_number: 'ORD-1',
  payment_status: 'pending',
};

const merchant: RefundNotificationMerchant = {
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

function pushSender(
  result: Awaited<ReturnType<MerchantRefundPushSender>> | Error
): MerchantRefundPushSender {
  const send = vi.fn();
  if (result instanceof Error) send.mockRejectedValue(result);
  else send.mockResolvedValue(result);
  return send as unknown as MerchantRefundPushSender;
}

function emailSender(
  result: Awaited<ReturnType<RefundEmailSender>> | Error
): RefundEmailSender {
  const send = vi.fn();
  if (result instanceof Error) send.mockRejectedValue(result);
  else send.mockResolvedValue(result);
  return send as unknown as RefundEmailSender;
}

function deliver(
  overrides: Partial<
    Parameters<typeof deliverMerchantRefundNotification>[1]
  > & {
    sendEmail: RefundEmailSender;
  }
) {
  return deliverMerchantRefundNotification({} as never, {
    amount: 'NGN 100.00',
    merchant,
    order,
    orderNumber: 'ORD-1',
    row: claimed('processed_merchant_push'),
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveContradictoryRefundFailure.mockResolvedValue(false);
});

describe('deliverMerchantRefundNotification', () => {
  it('sends the processed push and skips email on success', async () => {
    const sendMerchantPush = pushSender({ sent: 1, failed: 0, errors: [] });
    const sendEmail = emailSender({ success: true });

    await expect(deliver({ sendEmail, sendMerchantPush })).resolves.toEqual({
      lastError: null,
      outcome: 'sent',
    });

    expect(sendMerchantPush).toHaveBeenCalledWith(
      'merchant-1',
      'Refund processed',
      expect.stringContaining('ORD-1'),
      expect.objectContaining({ type: 'paystack_refund_processed' }),
      'payments'
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('falls back to capped email when push dispatch never starts', async () => {
    const sendMerchantPush = pushSender(new Error('expo down'));
    const sendEmail = emailSender({ success: true });

    await expect(
      deliver({
        row: claimed('failed_merchant_push'),
        sendEmail,
        sendMerchantPush,
      })
    ).resolves.toEqual({ lastError: null, outcome: 'sent' });

    expect(sendMerchantPush).toHaveBeenCalledWith(
      'merchant-1',
      'Refund needs attention',
      expect.stringContaining('ORD-1'),
      expect.objectContaining({ type: 'paystack_refund_needs_attention' }),
      'payments'
    );
    // The fallback email runs capped at one primary attempt: the row
    // budget already spent the push phase, and the sweep retries
    // transient failures next tick.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        emailType: 'notifications',
        maxAttemptsPerSender: 1,
        subject: 'Refund needs attention: order #ORD-1',
        to: 'store@example.com',
      })
    );
  });

  it('terminalizes uncertain push dispatch without email fallback', async () => {
    const sendMerchantPush = pushSender({
      sent: 0,
      failed: 0,
      errors: [],
      deliveryOutcome: 'unknown',
    });
    const sendEmail = emailSender({ success: true });

    await expect(deliver({ sendEmail, sendMerchantPush })).resolves.toEqual({
      lastError: 'refund_merchant_push_uncertain',
      outcome: 'delivery_uncertain',
    });

    // Emailing after a possibly-delivered push double-notifies.
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('fails without email when push fails and no merchant email exists', async () => {
    const sendMerchantPush = pushSender(new Error('expo down'));
    const sendEmail = emailSender({ success: true });

    await expect(
      deliver({
        merchant: { ...merchant, email: '' },
        sendEmail,
        sendMerchantPush,
      })
    ).resolves.toEqual({
      lastError: 'refund_merchant_contact_missing',
      outcome: 'failed',
    });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('skips the push and emails directly when only email fits', async () => {
    const sendMerchantPush = pushSender({ sent: 1, failed: 0, errors: [] });
    const sendEmail = emailSender({ success: true });
    // Room for the single-attempt email but not the push phase on
    // top: sending the email directly beats burning the attempt on a
    // push that starves it.
    const deadlineMs = Date.now() + zeptomailSendAdmissionBudgetMs(1) + 5_000;

    await expect(
      deliver({ deadlineMs, sendEmail, sendMerchantPush })
    ).resolves.toEqual({ lastError: null, outcome: 'sent' });

    expect(sendMerchantPush).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackDeadlineMs: deadlineMs - 10_000,
        maxAttemptsPerSender: 1,
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('retries an email-send throw when dispatch never started', async () => {
    const sendEmail = emailSender(new Error('smtp down'));

    await expect(deliver({ sendEmail })).resolves.toEqual({
      lastError: 'smtp down',
      outcome: 'failed',
    });
  });

  it('collapses an email-send throw to delivery_uncertain once dispatched', async () => {
    const sendEmail = vi.fn().mockImplementation(async (message: never) => {
      const { beforeTransportDispatch } = message as unknown as {
        beforeTransportDispatch?: () => Promise<void>;
      };
      await beforeTransportDispatch?.();
      throw new Error('smtp down');
    });

    await expect(deliver({ sendEmail: sendEmail as never })).resolves.toEqual({
      lastError: 'smtp down',
      outcome: 'delivery_uncertain',
    });
  });

  it.each([
    [
      { success: false, deliveryOutcome: 'unknown' } as const,
      'delivery_uncertain',
      'refund_merchant_email_unknown',
    ],
    [{ success: false } as const, 'failed', 'refund_merchant_email_rejected'],
  ])('classifies email result %j as %s', async (result, outcome, lastError) => {
    const sendEmail = emailSender(result);

    await expect(deliver({ sendEmail })).resolves.toEqual({
      lastError,
      outcome,
    });
  });

  it('suppresses a superseded contradictory failure without sending', async () => {
    mocks.resolveContradictoryRefundFailure.mockResolvedValue(true);
    const sendMerchantPush = pushSender({ sent: 1, failed: 0, errors: [] });
    const sendEmail = emailSender({ success: true });

    await expect(
      deliver({
        order: { ...order, payment_status: 'refunded' },
        row: claimed('failed_merchant_push'),
        sendEmail,
        sendMerchantPush,
      })
    ).resolves.toEqual({ lastError: null, outcome: 'sent' });

    expect(sendMerchantPush).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('defers a pre-send deadline instead of failing', async () => {
    const sendMerchantPush = pushSender({ sent: 1, failed: 0, errors: [] });
    const sendEmail = emailSender({ success: true });

    await expect(
      deliver({ deadlineMs: Date.now() - 1, sendEmail, sendMerchantPush })
    ).resolves.toEqual({
      lastError: 'refund_notification_deadline_before_send',
      outcome: 'deferred',
    });

    expect(sendMerchantPush).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
