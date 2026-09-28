import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { refundNotificationLedgerAmount } from './refund-notification-ledger';

const order = { currency: 'NGN', id: 'order-1' };

function database({
  payments,
  paymentError = null,
  refunds,
  refundError = null,
}: {
  payments: unknown[];
  paymentError?: unknown;
  refunds: unknown[];
  refundError?: unknown;
}) {
  const paymentQuery = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: payments, error: paymentError }),
    select: vi.fn().mockReturnThis(),
  };
  const refundQuery = {
    eq: vi.fn((column: string) =>
      column === 'status'
        ? Promise.resolve({ data: refunds, error: refundError })
        : refundQuery
    ),
    select: vi.fn().mockReturnThis(),
  };
  const from = vi
    .fn()
    .mockReturnValueOnce(paymentQuery)
    .mockReturnValueOnce(refundQuery);
  return { supabase: { from } as unknown as SupabaseClient };
}

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
          metadata: { payment_transaction_id: 'pay-1' },
        },
        {
          amount: 40,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: { payment_transaction_id: 'pay-2' },
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
          metadata: { payment_transaction_id: 'pay-1' },
        },
        {
          amount: 60,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: { payment_transaction_id: 'pay-1' },
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
          metadata: { payment_transaction_id: 'pay-1' },
        },
        {
          amount: 60,
          currency: 'USD',
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
