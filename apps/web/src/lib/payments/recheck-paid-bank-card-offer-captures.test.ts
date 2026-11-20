import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { recheckPaidBankCardOfferCaptures } from './recheck-paid-bank-card-offer-captures';
import { verifyGatewayCharge } from './verify-gateway-charge';

vi.mock('./verify-gateway-charge', () => ({ verifyGatewayCharge: vi.fn() }));

const candidate = {
  gateway_reference: `BCO-${'a'.repeat(32)}`,
  merchant_id: 'merchant-1',
  order_id: 'order-1',
  transaction_id: 'transaction-1',
};

function worker() {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: [candidate], error: null })
    .mockResolvedValue({ data: [], error: null });
  const finalizePayment = vi.fn().mockResolvedValue({
    kind: 'bank_offer_terminal',
    status: 'reversed',
  });
  const scheduleAfter = vi.fn();
  const supabase = { rpc } as unknown as SupabaseClient;
  return { rpc, finalizePayment, scheduleAfter, supabase };
}

describe('recheckPaidBankCardOfferCaptures', () => {
  it('files a paid reversal only through the terminal-only finalizer', async () => {
    const input = worker();
    vi.mocked(verifyGatewayCharge).mockResolvedValueOnce({
      ok: false,
      gatewayStatus: 'reversed',
      reason: 'gateway_status_not_success',
    });

    await expect(recheckPaidBankCardOfferCaptures(input)).resolves.toEqual({
      checked: 1,
      failed: 0,
      retrying: 0,
      reversed: 1,
    });

    expect(input.rpc).toHaveBeenCalledWith(
      'claim_paid_bank_card_offer_recheck'
    );
    expect(input.finalizePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedBankOfferTerminalStatus: 'reversed',
        gateway: 'paystack',
        orderId: candidate.order_id,
        reference: candidate.gateway_reference,
        transaction: expect.objectContaining({
          id: candidate.transaction_id,
          merchant_id: candidate.merchant_id,
        }),
      })
    );
  });

  it('does not finalize a paid capture again when Paystack still reports success', async () => {
    const input = worker();
    vi.mocked(verifyGatewayCharge).mockResolvedValueOnce({
      ok: true,
      amount: 95,
      currency: 'NGN',
      response: {},
    });

    await expect(recheckPaidBankCardOfferCaptures(input)).resolves.toEqual({
      checked: 1,
      failed: 0,
      retrying: 0,
      reversed: 0,
    });
    expect(input.finalizePayment).not.toHaveBeenCalled();
  });

  it('leaves a reversal eligible for retry if confirmation fails', async () => {
    const input = worker();
    vi.mocked(verifyGatewayCharge).mockResolvedValueOnce({
      ok: false,
      gatewayStatus: 'reversed',
      reason: 'gateway_status_not_success',
    });
    input.finalizePayment.mockResolvedValueOnce({ kind: 'completion_failed' });

    await expect(recheckPaidBankCardOfferCaptures(input)).resolves.toEqual({
      checked: 1,
      failed: 1,
      retrying: 0,
      reversed: 0,
    });
  });

  it('tracks a temporary provider outage as retryable', async () => {
    const input = worker();
    vi.mocked(verifyGatewayCharge).mockResolvedValueOnce({
      ok: false,
      reason: 'paystack_verification_unavailable',
    });

    await expect(recheckPaidBankCardOfferCaptures(input)).resolves.toEqual({
      checked: 1,
      failed: 0,
      retrying: 1,
      reversed: 0,
    });
    expect(input.finalizePayment).not.toHaveBeenCalled();
  });
});
