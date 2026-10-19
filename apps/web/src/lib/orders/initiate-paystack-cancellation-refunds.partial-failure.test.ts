import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayPaymentTransaction } from './gateway-payment-transaction';
import { initiatePaystackCancellationRefunds } from './initiate-paystack-cancellation-refunds';

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

describe('initiatePaystackCancellationRefunds partial failure', () => {
  const insert = vi.fn();
  const supabase = { from: vi.fn(() => ({ insert })) } as never;
  const order = {
    currency: 'NGN',
    id: 'order-1',
    merchant_id: 'merchant-1',
    order_number: 'B-1',
  };
  const firstLeg: GatewayPaymentTransaction = {
    amount: 12.5,
    currency: 'NGN',
    gateway: 'paystack',
    gateway_reference: 'PSK-1',
    id: 'tx-1',
  } as GatewayPaymentTransaction;
  const secondLeg: GatewayPaymentTransaction = {
    amount: 12.5,
    currency: 'NGN',
    gateway: 'paystack',
    gateway_reference: 'PSK-2',
    id: 'tx-2',
  } as GatewayPaymentTransaction;

  beforeEach(() => {
    vi.resetAllMocks();
    insert.mockResolvedValue({ error: null });
    mocks.quarantineRefund.mockRejectedValue(new Error('quarantined'));
  });

  function acceptFirstLeg() {
    mocks.initiatePaystackRefund.mockResolvedValueOnce({
      data: {
        id: 101,
        status: 'queued',
        transaction: { id: 55, reference: 'PSK-1' },
      },
      success: true,
    });
  }

  async function runWithSecondLegFailure(failure: Record<string, unknown>) {
    acceptFirstLeg();
    mocks.initiatePaystackRefund.mockResolvedValueOnce({
      error: 'refund failed',
      success: false,
      ...failure,
    });

    await expect(
      initiatePaystackCancellationRefunds({
        order,
        refundedPaymentIds: new Set(),
        supabase,
        transactions: [firstLeg, secondLeg],
      })
    ).rejects.toThrow('quarantined');
    return mocks.quarantineRefund.mock.calls[0][0].metadata as Record<
      string,
      unknown
    >;
  }

  it('marks the review ambiguous when the later leg fails ambiguously', async () => {
    const metadata = await runWithSecondLegFailure({
      code: 'HTTP_503',
    });

    expect(metadata).toMatchObject({
      accepted_refund_ids: [101],
      ambiguous_initiation: true,
      failed_payment_transaction_id: 'tx-2',
    });
  });

  it('leaves the review unambiguous when the later leg fails deterministically', async () => {
    const metadata = await runWithSecondLegFailure({
      code: 'HTTP_400',
    });

    expect(metadata).toMatchObject({
      accepted_refund_ids: [101],
      ambiguous_initiation: false,
      failed_payment_transaction_id: 'tx-2',
    });
  });
});
