import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initiatePaystackCancellationRefunds } from './initiate-paystack-cancellation-refunds';
import {
  initiationOrder,
  initiationTransaction,
  mockAcceptedRefund,
} from './initiate-paystack-cancellation-refunds.test-helpers';

const mocks = vi.hoisted(() => ({
  initiatePaystackRefund: vi.fn(),
  quarantineRefund: vi.fn(),
}));

vi.mock('@/lib/initiate-paystack-refund', () => ({
  initiateRefund: mocks.initiatePaystackRefund,
}));

vi.mock('./quarantine-order-cancellation-refund', () => ({
  quarantineRefund: mocks.quarantineRefund,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

describe('initiatePaystackCancellationRefunds', () => {
  const insert = vi.fn();
  const supabase = { from: vi.fn(() => ({ insert })) } as never;
  const order = initiationOrder;
  const transaction = initiationTransaction;

  beforeEach(() => {
    vi.resetAllMocks();
    insert.mockResolvedValue({ error: null });
  });

  function acceptedRefund(overrides: Record<string, unknown> = {}) {
    mockAcceptedRefund(mocks.initiatePaystackRefund, overrides);
  }

  it('quarantines a sub-kobo leg instead of refunding the whole transaction', async () => {
    const refundIds = await initiatePaystackCancellationRefunds({
      order,
      refundedPaymentIds: new Set(),
      supabase,
      transactions: [{ ...transaction, amount: 0.001 }],
    });

    // 0.001 rounds to 0 kobo, which the provider call would read as a
    // full-transaction refund: the leg quarantines and no provider
    // call goes out.
    expect(refundIds).toEqual([]);
    expect(mocks.initiatePaystackRefund).not.toHaveBeenCalled();
    const subKobo = { ...transaction, amount: 0.001 };
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({ transactions: [subKobo] })
    );
  });

  it('uses the exact saved kobo amount for a bank-offer refund', async () => {
    const reference = `BCO-${'a'.repeat(32)}`;
    acceptedRefund({ transaction: { id: 55, reference } });
    const rpc = vi.fn().mockResolvedValue({ data: 9501, error: null });

    await expect(
      initiatePaystackCancellationRefunds({
        order,
        refundedPaymentIds: new Set(),
        supabase: { from: vi.fn(() => ({ insert })), rpc } as never,
        transactions: [
          { ...transaction, amount: 95, gateway_reference: reference },
        ],
      })
    ).resolves.toEqual([101]);

    expect(mocks.initiatePaystackRefund).toHaveBeenCalledWith(
      reference,
      9501,
      'Order cancelled',
      undefined
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '95.01' })
    );
  });

  it.each([
    false,
    true,
  ])('withholds the bank refund when capture lookup is denied (last attempt %s)', async (isLastAttempt) => {
    const leg = { ...transaction, gateway_reference: `BCO-${'a'.repeat(32)}` };
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '42501' } });

    await expect(
      initiatePaystackCancellationRefunds({
        order,
        isLastAttempt,
        refundedPaymentIds: new Set(),
        supabase: { from: vi.fn(() => ({ insert })), rpc } as never,
        transactions: [leg],
      })
    ).rejects.toThrow('Unable to verify bank card offer refund capture');

    expect(mocks.initiatePaystackRefund).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    if (isLastAttempt) {
      expect(mocks.quarantineRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          transactions: [leg],
          metadata: expect.objectContaining({
            bank_offer_capture_lookup_unavailable: true,
          }),
        })
      );
    } else {
      expect(mocks.quarantineRefund).not.toHaveBeenCalled();
    }
  });

  it('checks the saved offer when a bank-offer order has an unexpected leg reference', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await expect(
      initiatePaystackCancellationRefunds({
        order: { ...order, payment_method: 'bank_card_offer' },
        refundedPaymentIds: new Set(),
        supabase: { from: vi.fn(() => ({ insert })), rpc } as never,
        transactions: [transaction],
      })
    ).resolves.toEqual([]);

    expect(rpc).toHaveBeenCalledWith(
      'get_bank_card_offer_refundable_amount',
      expect.objectContaining({ p_reference: transaction.gateway_reference })
    );
    expect(mocks.quarantineRefund).toHaveBeenCalled();
    expect(mocks.initiatePaystackRefund).not.toHaveBeenCalled();
  });

  it('audits accepted refunds as refund_pending before returning', async () => {
    acceptedRefund();

    const refundIds = await initiatePaystackCancellationRefunds({
      order,
      refundedPaymentIds: new Set(),
      supabase,
      transactions: [transaction],
    });

    expect(refundIds).toEqual([101]);
    expect(mocks.initiatePaystackRefund).toHaveBeenCalledWith(
      'PSK-1',
      1250,
      'Order cancelled',
      undefined
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway_reference: '101',
        status: 'refund_pending',
        transaction_type: 'refund',
      })
    );
  });

  it.each([
    'failed',
    'needs-attention',
  ])('omits an immediate %s verdict from the audit row', async (status) => {
    acceptedRefund({ status });

    const refundIds = await initiatePaystackCancellationRefunds({
      order,
      refundedPaymentIds: new Set(),
      supabase,
      transactions: [transaction],
    });

    // Pre-populating the failure verdict would make the record RPC's
    // repeat guard return before transitioning the row or queuing the
    // merchant failure notification; the first reconcile applies it.
    expect(refundIds).toEqual([101]);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.not.objectContaining({
          provider_refund_status: expect.anything(),
        }),
      })
    );
  });

  it('keeps a non-terminal provider status on the audit row', async () => {
    acceptedRefund({ status: 'queued' });

    await initiatePaystackCancellationRefunds({
      order,
      refundedPaymentIds: new Set(),
      supabase,
      transactions: [transaction],
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          provider_refund_status: 'queued',
        }),
      })
    );
  });

  it('skips legs already recorded as refunded', async () => {
    acceptedRefund();

    const refundIds = await initiatePaystackCancellationRefunds({
      order,
      refundedPaymentIds: new Set(['tx-1']),
      supabase,
      transactions: [transaction],
    });

    expect(refundIds).toEqual([]);
    expect(mocks.initiatePaystackRefund).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('files the accepted provider ID for review when the audit row fails', async () => {
    acceptedRefund();
    insert.mockResolvedValue({ error: new Error('insert failed') });
    mocks.quarantineRefund.mockRejectedValue(new Error('quarantined'));

    await expect(
      initiatePaystackCancellationRefunds({
        order,
        refundedPaymentIds: new Set(),
        supabase,
        transactions: [transaction],
      })
    ).rejects.toThrow('quarantined');
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          audit_record_failed: true,
          provider_refund_id: 101,
        }),
      })
    );
  });

  it('treats a duplicate audit row as recorded without quarantining', async () => {
    acceptedRefund();
    insert.mockResolvedValue({ error: { code: '23505' } });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        amount: 12.5,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: '101',
        id: 'refund-1',
        metadata: { payment_transaction_id: 'tx-1' },
        transaction_type: 'refund',
      },
      error: null,
    });
    const local = {
      from: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        insert,
        maybeSingle,
        select: vi.fn().mockReturnThis(),
      })),
    } as never;

    const refundIds = await initiatePaystackCancellationRefunds({
      order,
      refundedPaymentIds: new Set(),
      supabase: local,
      transactions: [transaction],
    });

    expect(refundIds).toEqual([101]);
    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
  });

  it('quarantines a cross-type reference collision instead of trusting it', async () => {
    acceptedRefund();
    insert.mockResolvedValue({ error: { code: '23505' } });
    mocks.quarantineRefund.mockRejectedValue(new Error('quarantined'));
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        gateway: 'paystack',
        gateway_reference: '101',
        id: 'payment-other',
        transaction_type: 'payment',
      },
      error: null,
    });
    const local = {
      from: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        insert,
        maybeSingle,
        select: vi.fn().mockReturnThis(),
      })),
    } as never;

    await expect(
      initiatePaystackCancellationRefunds({
        order,
        refundedPaymentIds: new Set(),
        supabase: local,
        transactions: [transaction],
      })
    ).rejects.toThrow('quarantined');
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          audit_record_failed: true,
          payment_transaction_id: 'tx-1',
          provider_refund_id: 101,
        }),
      })
    );
  });
});
