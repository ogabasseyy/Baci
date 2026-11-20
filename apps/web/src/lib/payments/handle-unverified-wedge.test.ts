import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { handleUnverifiedWedge } from './handle-unverified-wedge';
import type { WedgedCandidate } from './reconcile-wedged-gateway-orders.types';

const candidate: WedgedCandidate = {
  id: 'transaction',
  order_id: 'order',
  merchant_id: 'merchant',
  gateway: 'paystack',
  gateway_reference: `BCO-${'a'.repeat(32)}`,
  currency: 'NGN',
  amount: 95,
  status: 'completed',
  platform_fee: null,
  metadata: null,
  created_at: '2026-11-20T11:00:00Z',
};

function setup() {
  return {
    candidate,
    finalizePayment: vi.fn(),
    retire: vi.fn(),
    stamp: vi.fn(),
    scheduleAfter: vi.fn(),
    summary: {
      skipped: [],
      reviewsFiled: [],
      failed: [],
      healed: [],
      checked: 0,
      detectedUnhealable: [],
    },
    supabase: {} as SupabaseClient,
    verification: {
      ok: false as const,
      reason: 'gateway_status_not_success',
      gatewayStatus: 'reversed',
    },
  };
}

it('retires an ordinary terminal outcome', async () => {
  const args = setup();
  args.candidate = { ...candidate, gateway_reference: 'BAC-transaction' };
  await handleUnverifiedWedge(args);
  expect(args.retire).toHaveBeenCalledWith(
    expect.objectContaining({ resolution: 'gateway_verification_negative' })
  );
  expect(args.finalizePayment).not.toHaveBeenCalled();
});

it('leaves transient gateway failures eligible for retry', async () => {
  const args = setup();
  await handleUnverifiedWedge({
    ...args,
    verification: { ok: false, reason: 'paystack_verification_unavailable' },
  });
  expect(args.retire).not.toHaveBeenCalled();
  expect(args.stamp).not.toHaveBeenCalled();
  expect(args.finalizePayment).not.toHaveBeenCalled();
});

it.each([
  true,
  false,
])('stamps a bank-offer reversal only after the record is durable (stamp success %s)', async (stampSuccess) => {
  const args = setup();
  args.finalizePayment.mockResolvedValue({
    kind: 'bank_offer_terminal',
    status: 'reversed',
  });
  args.stamp.mockResolvedValue(stampSuccess);

  await handleUnverifiedWedge(args);

  expect(args.finalizePayment).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedBankOfferTerminalStatus: 'reversed',
      reference: candidate.gateway_reference,
    })
  );
  expect(args.stamp).toHaveBeenCalledWith(
    args.supabase,
    candidate,
    'gateway_verification_negative'
  );
  expect(args.summary.reviewsFiled).toEqual([
    { orderId: 'order', transactionId: 'transaction' },
  ]);
  expect(args.summary.failed).toEqual(
    stampSuccess
      ? []
      : [
          {
            reason: 'bank_offer_terminal_stamp_failed',
            transactionId: 'transaction',
          },
        ]
  );
  expect(args.retire).not.toHaveBeenCalled();
});

it('leaves a bank-offer reversal eligible for retry when recording fails', async () => {
  const args = setup();
  args.finalizePayment.mockResolvedValue({ kind: 'completion_failed' });

  await handleUnverifiedWedge(args);

  expect(args.stamp).not.toHaveBeenCalled();
  expect(args.retire).not.toHaveBeenCalled();
  expect(args.summary.failed).toEqual([
    { reason: 'completion_failed', transactionId: 'transaction' },
  ]);
});

it.each([
  'failed',
  'cancelled',
  'abandoned',
] as const)('records the bank offer status %s before stamping', async (status) => {
  const args = setup();
  args.finalizePayment.mockResolvedValue({
    kind: 'bank_offer_terminal',
    status,
  });
  args.stamp.mockResolvedValue(true);

  await handleUnverifiedWedge({
    ...args,
    verification: { ...args.verification, gatewayStatus: status },
  });

  expect(args.finalizePayment).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedBankOfferTerminalStatus: status,
    })
  );
  expect(args.stamp).toHaveBeenCalled();
  expect(args.retire).not.toHaveBeenCalled();
});
