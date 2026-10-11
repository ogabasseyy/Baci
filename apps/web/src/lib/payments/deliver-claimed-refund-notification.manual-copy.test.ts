import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./refund-notification-ledger', () => ({
  refundNotificationLedgerAmount: vi.fn(),
}));
vi.mock('./deliver-merchant-refund-notification', () => ({
  deliverMerchantRefundNotification: vi.fn(),
}));

import { deliverClaimedRefundNotification } from './deliver-claimed-refund-notification';
import { deliverMerchantRefundNotification } from './deliver-merchant-refund-notification';
import { refundNotificationLedgerAmount } from './refund-notification-ledger';

const row = {
  attempts: 0,
  claim_token: 'token',
  created_at: '2026-09-28T12:00:00Z',
  event_type: 'processed_customer_email',
  generation: 1,
  id: 'row-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
} as const;

function buildSupabase(refundGateways: Array<{ gateway: unknown }>) {
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    if (table === 'orders') {
      chain.single = vi.fn().mockResolvedValue({
        data: {
          cancelled_at: '2026-09-28T12:00:00Z',
          currency: 'NGN',
          customer_email: 'buyer@example.test',
          customer_id: null,
          customer_name: 'Ada',
          id: 'order-1',
          merchant_id: 'merchant-1',
          order_number: '1001',
          payment_status: 'refunded',
        },
        error: null,
      });
    } else if (table === 'merchants') {
      chain.single = vi.fn().mockResolvedValue({
        data: {
          business_name: 'Shop',
          email: 'shop@example.test',
          email_sender_name: null,
          id: 'merchant-1',
          support_email: null,
        },
        error: null,
      });
    } else {
      // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
      chain.then = (resolve: (value: unknown) => void) =>
        Promise.resolve({
          data: refundGateways,
          error: null,
        }).then(resolve);
    }
    return chain;
  });
  return { from };
}

function deliver(refundGateways: Array<{ gateway: unknown }>) {
  const sendEmail = vi
    .fn()
    .mockResolvedValue({ deliveryOutcome: undefined, success: true });
  return {
    promise: deliverClaimedRefundNotification({
      row: { ...row },
      sendEmail,
      supabase: { from: buildSupabase(refundGateways).from } as never,
    }),
    sendEmail,
  };
}

describe('deliverClaimedRefundNotification manual copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(refundNotificationLedgerAmount).mockResolvedValue('₦100.00');
    vi.mocked(deliverMerchantRefundNotification).mockResolvedValue({
      lastError: null,
      outcome: 'sent',
    });
  });

  it('uses neutral copy when every refund row is manual', async () => {
    const { promise, sendEmail } = deliver([
      { gateway: 'manual' },
      { gateway: 'manual' },
    ]);

    await expect(promise).resolves.toMatchObject({ outcome: 'sent' });
    const message = vi.mocked(sendEmail).mock.calls[0][0];
    expect(message.textContent).toContain('If you have any questions');
    expect(message.textContent).not.toContain('business days');
    expect(message.htmlContent).toContain('If you have any questions');
    expect(message.htmlContent).not.toContain('business days');
  });

  it('keeps the provider timeline when any refund row is non-manual', async () => {
    const { promise, sendEmail } = deliver([
      { gateway: 'manual' },
      { gateway: 'paystack' },
    ]);

    await expect(promise).resolves.toMatchObject({ outcome: 'sent' });
    const message = vi.mocked(sendEmail).mock.calls[0][0];
    expect(message.textContent).toContain('10 business days');
    expect(message.htmlContent).toContain('10 business days');
  });

  it('fails toward the provider copy on unknown gateways', async () => {
    const { promise, sendEmail } = deliver([
      { gateway: null },
      { gateway: '' },
    ]);

    await expect(promise).resolves.toMatchObject({ outcome: 'sent' });
    expect(vi.mocked(sendEmail).mock.calls[0][0].textContent).toContain(
      '10 business days'
    );
  });
});
