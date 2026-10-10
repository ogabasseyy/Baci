import { describe, expect, it } from 'vitest';
import { refundNotificationLedgerAmount } from './refund-notification-ledger';
import { refundNotificationLedgerTestKit } from './refund-notification-ledger.test-helpers';

const { database, order } = refundNotificationLedgerTestKit;

describe('refundNotificationLedgerAmount partial refunds', () => {
  it('sums partial refunds to cover a leg', async () => {
    const { supabase } = database({
      payments: [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'paystack',
          id: 'pay-1',
          status: 'completed',
        },
      ],
      refunds: [
        {
          amount: 40,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: {
            payment_transaction_id: 'pay-1',
            provider_refund_status: 'processed',
          },
        },
        {
          amount: 60,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: {
            payment_transaction_id: 'pay-1',
            provider_refund_status: 'processed',
          },
        },
      ],
    });

    const amount = await refundNotificationLedgerAmount({
      merchantId: 'merchant-1',
      order,
      supabase,
    });

    expect(amount).toContain('100');
  });

  it('throws when partial refunds fall short of the leg', async () => {
    const { supabase } = database({
      payments: [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'paystack',
          id: 'pay-1',
          status: 'completed',
        },
      ],
      refunds: [
        {
          amount: 40,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: {
            payment_transaction_id: 'pay-1',
            provider_refund_status: 'processed',
          },
        },
      ],
    });

    await expect(
      refundNotificationLedgerAmount({
        merchantId: 'merchant-1',
        order,
        supabase,
      })
    ).rejects.toThrow('refund_notification_ledger_mismatch');
  });

  it('ignores foreign-currency partials when summing a leg', async () => {
    const { supabase } = database({
      payments: [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'paystack',
          id: 'pay-1',
          status: 'completed',
        },
      ],
      refunds: [
        {
          amount: 40,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: {
            payment_transaction_id: 'pay-1',
            provider_refund_status: 'processed',
          },
        },
        {
          amount: 60,
          currency: 'USD',
          gateway: 'paystack',
          metadata: {
            payment_transaction_id: 'pay-1',
            provider_refund_status: 'processed',
          },
        },
      ],
    });

    await expect(
      refundNotificationLedgerAmount({
        merchantId: 'merchant-1',
        order,
        supabase,
      })
    ).rejects.toThrow('refund_notification_ledger_mismatch');
  });
});
