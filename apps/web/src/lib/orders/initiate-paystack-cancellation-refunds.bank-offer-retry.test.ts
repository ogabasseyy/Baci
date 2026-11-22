import { beforeEach, expect, it, vi } from 'vitest';
import { initiatePaystackCancellationRefunds } from './initiate-paystack-cancellation-refunds';
import {
  initiationOrder,
  initiationTransaction,
  mockAcceptedRefund,
} from './initiate-paystack-cancellation-refunds.test-helpers';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

const mocks = vi.hoisted(() => ({
  initiateRefund: vi.fn(),
  verifyTransaction: vi.fn(),
}));

vi.mock('@/lib/initiate-paystack-refund', () => ({
  initiateRefund: mocks.initiateRefund,
}));
vi.mock('@/lib/paystack', () => ({
  verifyTransaction: mocks.verifyTransaction,
}));

const reference = `BCO-${'a'.repeat(32)}`;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verifyTransaction.mockResolvedValue({
    success: true,
    data: {
      status: 'success',
      reference,
      amount: 9500,
      currency: 'NGN',
      domain: 'test',
      id: '55',
    },
  });
});

function startWorkerPass() {
  let admittedClaim: string | null = null;
  const rpc = vi.fn(async (name: string, args: { p_claim_token?: string }) => {
    if (name === 'get_bank_card_offer_refundable_amount') {
      return { data: 9500, error: null };
    }
    if (name === 'begin_bank_card_offer_refund_dispatch') {
      if (admittedClaim) return { data: 'already_admitted', error: null };
      admittedClaim = args.p_claim_token ?? null;
      return { data: 'dispatch', error: null };
    }
    if (
      name === 'release_rejected_bank_card_offer_refund_dispatch' &&
      args.p_claim_token === admittedClaim
    ) {
      admittedClaim = null;
      return { data: true, error: null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
  const insert = vi.fn().mockResolvedValue({ error: null });
  return {
    rpc,
    run: (claimToken: string) =>
      initiatePaystackCancellationRefunds({
        claimToken,
        order: initiationOrder,
        refundedPaymentIds: new Set(),
        supabase: { from: vi.fn(() => ({ insert })), rpc } as never,
        transactions: [
          { ...initiationTransaction, gateway_reference: reference },
        ],
      }),
  };
}

it.each([
  'HTTP_429',
  'HTTP_401',
  'HTTP_403',
  'CONFIG_ERROR',
])('allows the next worker to try a refund after a definite %s refusal', async (code) => {
  const { rpc, run } = startWorkerPass();
  mocks.initiateRefund.mockResolvedValueOnce({
    success: false,
    code,
    error: 'Refund was not accepted',
  });
  mockAcceptedRefund(mocks.initiateRefund, {
    transaction: { id: 55, reference },
  });

  await expect(run('claim-1')).rejects.toThrow('Refund was not accepted');
  expect(rpc).toHaveBeenLastCalledWith(
    'release_rejected_bank_card_offer_refund_dispatch',
    expect.objectContaining({
      p_claim_token: 'claim-1',
      p_reference: reference,
      p_rejection_code: code,
    })
  );
  await expect(run('claim-2')).resolves.toEqual([101]);
  expect(mocks.initiateRefund).toHaveBeenCalledTimes(2);
});

it.each([
  'NETWORK_ERROR',
  'HTTP_408',
  'HTTP_503',
  'MALFORMED_RESPONSE',
])('keeps the admission after the ambiguous %s response', async (code) => {
  const { rpc, run } = startWorkerPass();
  mocks.initiateRefund.mockResolvedValueOnce({
    success: false,
    code,
    error: 'Refund acceptance unknown',
  });

  await expect(run('claim-1')).rejects.toBeInstanceOf(DeliveryUncertainError);
  expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
    'release_rejected_bank_card_offer_refund_dispatch'
  );
  await expect(run('claim-2')).rejects.toBeInstanceOf(DeliveryUncertainError);
  expect(mocks.initiateRefund).toHaveBeenCalledTimes(1);
});
