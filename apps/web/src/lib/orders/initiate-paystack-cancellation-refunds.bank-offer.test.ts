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
  verifyTransaction: vi.fn(),
}));

vi.mock('@/lib/initiate-paystack-refund', () => ({
  initiateRefund: mocks.initiatePaystackRefund,
}));
vi.mock('@/lib/paystack', () => ({
  verifyTransaction: mocks.verifyTransaction,
}));

vi.mock('./quarantine-order-cancellation-refund', () => ({
  quarantineRefund: mocks.quarantineRefund,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

describe('bank-offer cancellation refunds', () => {
  const insert = vi.fn();
  const order = initiationOrder;
  const transaction = initiationTransaction;

  beforeEach(() => {
    vi.resetAllMocks();
    insert.mockResolvedValue({ error: null });
  });

  function acceptedRefund(overrides: Record<string, unknown> = {}) {
    mockAcceptedRefund(mocks.initiatePaystackRefund, overrides);
  }

  it.each([
    'NGN',
    'ngn',
  ])('uses the exact saved kobo amount for a bank-offer refund (%s)', async (currency) => {
    const reference = `BCO-${'a'.repeat(32)}`;
    acceptedRefund({ transaction: { id: 55, reference } });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: 9501, error: null })
      .mockResolvedValueOnce({ data: 'dispatch', error: null });
    mocks.verifyTransaction.mockResolvedValueOnce({
      success: true,
      data: {
        status: 'success',
        reference,
        amount: 9501,
        currency,
        domain: 'test',
        id: '55',
      },
    });

    await expect(
      initiatePaystackCancellationRefunds({
        claimToken: 'claim-1',
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
    expect(rpc).toHaveBeenLastCalledWith(
      'begin_bank_card_offer_refund_dispatch',
      expect.objectContaining({
        p_claim_token: 'claim-1',
        p_provider_id: '55',
        p_amount_kobo: 9501,
      })
    );
  });

  it.each([
    { currency: null },
    { id: 55 },
  ])('quarantines malformed successful verification %j before refund dispatch', async (invalidFields) => {
    const reference = `BCO-${'a'.repeat(32)}`;
    const leg = { ...transaction, gateway_reference: reference };
    const rpc = vi.fn().mockResolvedValueOnce({ data: 9501, error: null });
    mocks.verifyTransaction.mockResolvedValueOnce({
      success: true,
      data: {
        status: 'success',
        reference,
        amount: 9501,
        currency: 'NGN',
        domain: 'test',
        id: '55',
        ...invalidFields,
      },
    });
    await expect(
      initiatePaystackCancellationRefunds({
        claimToken: 'claim-1',
        order,
        refundedPaymentIds: new Set(),
        supabase: { rpc } as never,
        transactions: [leg],
      })
    ).resolves.toEqual([]);
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        transactions: [leg],
      })
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(mocks.initiatePaystackRefund).not.toHaveBeenCalled();
  });

  it.each([
    'reversed',
    'raced',
    'admitted',
  ])('withholds the refund when a reversal is %s', async (state) => {
    const reference = `BCO-${'a'.repeat(32)}`;
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: 9501, error: null })
      .mockResolvedValueOnce({
        data: state === 'admitted' ? 'already_admitted' : 'blocked',
        error: null,
      });
    mocks.verifyTransaction.mockResolvedValueOnce({
      success: true,
      data: {
        status: state === 'reversed' ? 'reversed' : 'success',
        reference,
        amount: 9501,
        currency: 'NGN',
        domain: 'test',
        id: '55',
      },
    });
    await expect(
      initiatePaystackCancellationRefunds({
        claimToken: 'claim-1',
        order,
        refundedPaymentIds: new Set(),
        supabase: { from: vi.fn(() => ({ insert })), rpc } as never,
        transactions: [{ ...transaction, gateway_reference: reference }],
      })
    ).resolves.toEqual([]);
    expect(mocks.initiatePaystackRefund).not.toHaveBeenCalled();
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          ambiguous_initiation: state === 'admitted',
        }),
      })
    );
  });

  it('defers a bank-offer refund when capture lookup consumes the provider budget', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_200_000);
    const reference = `BCO-${'a'.repeat(32)}`;
    acceptedRefund({ transaction: { id: 55, reference } });
    const rpc = vi.fn().mockImplementation(async () => {
      now.mockReturnValue(1_210_000);
      return { data: 9501, error: null };
    });

    try {
      await expect(
        initiatePaystackCancellationRefunds({
          claimToken: 'claim-1',
          deadlineMs: 1_238_000,
          order,
          refundedPaymentIds: new Set(),
          supabase: { from: vi.fn(() => ({ insert })), rpc } as never,
          transactions: [{ ...transaction, gateway_reference: reference }],
        })
      ).rejects.toThrow('cancellation_refund_deadline_exceeded');
      expect(mocks.initiatePaystackRefund).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
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
        claimToken: 'claim-1',
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

  it.each([
    ['bank_card_offer', 'PSK-1'],
    ['paystack', 'BCO-malformed'],
  ])('quarantines unexpected %s refund reference %s before lookup', async (paymentMethod, reference) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await expect(
      initiatePaystackCancellationRefunds({
        order: { ...order, payment_method: paymentMethod },
        refundedPaymentIds: new Set(),
        supabase: { from: vi.fn(() => ({ insert })), rpc } as never,
        transactions: [{ ...transaction, gateway_reference: reference }],
      })
    ).resolves.toEqual([]);

    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.quarantineRefund).toHaveBeenCalled();
    expect(mocks.initiatePaystackRefund).not.toHaveBeenCalled();
  });

  it('quarantines a bank-offer refund that has no worker claim', async () => {
    const leg = { ...transaction, gateway_reference: `BCO-${'a'.repeat(32)}` };
    const rpc = vi.fn();
    await initiatePaystackCancellationRefunds({
      order,
      refundedPaymentIds: new Set(),
      supabase: { rpc } as never,
      transactions: [leg],
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.initiatePaystackRefund).not.toHaveBeenCalled();
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({ transactions: [leg] })
    );
  });
});
