import { describe, expect, it } from 'vitest';
import { refundNotificationLedgerAmount } from './refund-notification-ledger';
import { refundNotificationLedgerTestKit } from './refund-notification-ledger.test-helpers';

const { database, order } = refundNotificationLedgerTestKit;

describe('refundNotificationLedgerAmount manual legs', () => {
  it('totals a cash-only order from its linked manual rows', async () => {
    const { supabase } = database({
      payments: [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'cash',
          id: 'pay-cash',
          status: 'completed',
        },
      ],
      refunds: [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'manual',
          metadata: { payment_transaction_id: 'pay-cash' },
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

  it('includes a manually covered cash leg beside provider legs', async () => {
    const { supabase } = database({
      payments: [
        {
          amount: 60,
          currency: 'NGN',
          gateway: 'paystack',
          id: 'pay-1',
          status: 'completed',
        },
        {
          amount: 40,
          currency: 'NGN',
          gateway: 'cash',
          id: 'pay-cash',
          status: 'completed',
        },
      ],
      refunds: [
        {
          amount: 60,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: {
            payment_transaction_id: 'pay-1',
            provider_refund_status: 'processed',
          },
        },
        {
          amount: 40,
          currency: 'NGN',
          gateway: 'manual',
          metadata: { payment_transaction_id: 'pay-cash' },
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

  it('mismatches when a cash leg lacks full manual coverage', async () => {
    const { supabase } = database({
      payments: [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'cash',
          id: 'pay-cash',
          status: 'completed',
        },
      ],
      refunds: [
        {
          amount: 40,
          currency: 'NGN',
          gateway: 'manual',
          metadata: { payment_transaction_id: 'pay-cash' },
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

  it('ignores wallet legs while totaling manual legs', async () => {
    const { supabase } = database({
      payments: [
        {
          amount: 40,
          currency: 'NGN',
          gateway: 'wallet',
          id: 'pay-wallet',
          status: 'completed',
        },
        {
          amount: 60,
          currency: 'NGN',
          gateway: 'store_credit',
          id: 'pay-sc',
          status: 'completed',
        },
      ],
      refunds: [
        {
          amount: 60,
          currency: 'NGN',
          gateway: 'manual',
          metadata: { payment_transaction_id: 'pay-sc' },
        },
      ],
    });

    const amount = await refundNotificationLedgerAmount({
      merchantId: 'merchant-1',
      order,
      supabase,
    });

    expect(amount).toContain('60');
    expect(amount).not.toContain('100');
  });
});
