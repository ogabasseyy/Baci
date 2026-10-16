import { describe, expect, it } from 'vitest';
import { refundNotificationLedgerAmount } from './refund-notification-ledger';
import { refundNotificationLedgerTestKit } from './refund-notification-ledger.test-helpers';

const { database, order } = refundNotificationLedgerTestKit;

function run(payments: unknown[], refunds: unknown[]) {
  const { supabase } = database({ payments, refunds });
  return refundNotificationLedgerAmount({
    merchantId: 'merchant-1',
    order,
    supabase,
  });
}

describe('refundNotificationLedgerAmount coverage parity', () => {
  it('caps an overfunded provider leg at the leg amount', async () => {
    const amount = await run(
      [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'paystack',
          id: 'pay-1',
          status: 'completed',
        },
      ],
      [
        {
          amount: 200,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: {
            payment_transaction_id: 'pay-1',
            provider_refund_status: 'processed',
          },
        },
      ]
    );

    expect(amount).toContain('100');
    expect(amount).not.toContain('200');
  });

  it('caps an overfunded cash leg at the leg amount', async () => {
    const amount = await run(
      [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'cash',
          id: 'pay-cash',
          status: 'completed',
        },
      ],
      [
        {
          amount: 150,
          currency: 'NGN',
          gateway: 'manual',
          metadata: { payment_transaction_id: 'pay-cash' },
        },
      ]
    );

    expect(amount).toContain('100');
    expect(amount).not.toContain('150');
  });

  it('excludes unverified manual-Paystack rows on provider legs', async () => {
    await expect(
      run(
        [
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'paystack',
            id: 'pay-1',
            status: 'completed',
          },
        ],
        [
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'manual',
            metadata: {
              method: 'paystack',
              payment_transaction_id: 'pay-1',
            },
          },
        ]
      )
    ).rejects.toThrow('refund_notification_ledger_mismatch');
  });

  it('excludes unverified manual-Paystack rows on cash legs', async () => {
    await expect(
      run(
        [
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'cash',
            id: 'pay-cash',
            status: 'completed',
          },
        ],
        [
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'manual',
            metadata: {
              method: 'paystack',
              payment_transaction_id: 'pay-cash',
            },
          },
        ]
      )
    ).rejects.toThrow('refund_notification_ledger_mismatch');
  });

  it('counts provider-verified manual-Paystack rows', async () => {
    const amount = await run(
      [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'cash',
          id: 'pay-cash',
          status: 'completed',
        },
      ],
      [
        {
          amount: 100,
          currency: 'NGN',
          gateway: 'manual',
          metadata: {
            method: 'paystack',
            payment_transaction_id: 'pay-cash',
            provider_refund_status: 'processed',
          },
        },
      ]
    );

    expect(amount).toContain('100');
  });
});
