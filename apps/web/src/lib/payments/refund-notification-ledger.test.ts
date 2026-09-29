import { describe, expect, it } from 'vitest';
import { refundNotificationLedgerAmount } from './refund-notification-ledger';
import { refundNotificationLedgerTestKit } from './refund-notification-ledger.test-helpers';

const { database, order } = refundNotificationLedgerTestKit;

describe('refundNotificationLedgerAmount', () => {
  it('totals every linked leg including refund-pending ones', async () => {
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
          gateway: 'paystack',
          id: 'pay-2',
          status: 'refund_pending',
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
          gateway: 'paystack',
          metadata: {
            payment_transaction_id: 'pay-2',
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

  it('totals self-terminal legs with no refund rows at all', async () => {
    const { supabase } = database({
      payments: [
        {
          amount: 40,
          currency: 'NGN',
          gateway: 'paypal',
          id: 'pay-2',
          status: 'refunded',
        },
      ],
      refunds: [],
    });

    const amount = await refundNotificationLedgerAmount({
      merchantId: 'merchant-1',
      order,
      supabase,
    });

    expect(amount).toContain('40');
  });

  it('lets self-terminal refunded legs contribute without a refund row', async () => {
    const { supabase } = database({
      payments: [
        {
          amount: 40,
          currency: 'NGN',
          gateway: 'paypal',
          id: 'pay-2',
          status: 'refunded',
        },
      ],
      refunds: [
        {
          amount: 1,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: {},
        },
      ],
    });

    const amount = await refundNotificationLedgerAmount({
      merchantId: 'merchant-1',
      order,
      supabase,
    });

    expect(amount).toContain('40');
  });

  it('excludes unverified Paystack rows from the total', async () => {
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
          metadata: { payment_transaction_id: 'pay-1' },
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

  it('throws when a leg has no linked refund', async () => {
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
          gateway: 'paystack',
          id: 'pay-2',
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

  it('throws when no refund rows back a non-self-terminal leg', async () => {
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
      refunds: [],
    });

    await expect(
      refundNotificationLedgerAmount({
        merchantId: 'merchant-1',
        order,
        supabase,
      })
    ).rejects.toThrow('refund_notification_ledger_lookup_failed');
  });

  it('throws when the payment lookup fails', async () => {
    const { supabase } = database({
      payments: [],
      paymentError: new Error('db down'),
      refunds: [],
    });

    await expect(
      refundNotificationLedgerAmount({
        merchantId: 'merchant-1',
        order,
        supabase,
      })
    ).rejects.toThrow('refund_notification_ledger_lookup_failed');
  });
});
