import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ledgerRepairPickupPaymentClaimMismatch } from './ledger-repair-pickup-payment-claim-mismatch';

const resolveTrusted = vi.hoisted(() => vi.fn());
const recordMismatch = vi.hoisted(() => vi.fn());

vi.mock('./resolve-trusted-repair-pickup-mismatch-binding', () => ({
  resolveTrustedRepairPickupMismatchBinding: resolveTrusted,
}));
vi.mock('./record-repair-pickup-payment-mismatch', () => ({
  recordRepairPickupPaymentMismatch: recordMismatch,
}));

const merchantId = '123e4567-e89b-12d3-a456-426614174000';
const repairId = '223e4567-e89b-12d3-a456-426614174000';
const reference = 'RPU-ABC123DEF45678';

describe('ledgerRepairPickupPaymentClaimMismatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('retries when trusted binding lookup fails', async () => {
    resolveTrusted.mockResolvedValueOnce({ kind: 'lookup_failed' });

    const result = await ledgerRepairPickupPaymentClaimMismatch({
      claim: null,
      currency: 'NGN',
      gatewayResponse: {},
      reference,
      supabase: {} as never,
      verifiedAmount: 8250,
    });

    expect(result).toEqual({
      handled: true,
      status: 503,
      body: {
        message: 'Repair pickup payment mismatch will retry until durable',
      },
    });
    expect(recordMismatch).not.toHaveBeenCalled();
  });

  it('ignores orphan mismatches without a trusted binding', async () => {
    resolveTrusted.mockResolvedValueOnce({ kind: 'orphan' });

    const result = await ledgerRepairPickupPaymentClaimMismatch({
      claim: null,
      currency: 'NGN',
      gatewayResponse: {},
      reference,
      supabase: {} as never,
      verifiedAmount: 8250,
    });

    expect(result.status).toBe(200);
    expect(result.body.message).toContain('unbound');
    expect(recordMismatch).not.toHaveBeenCalled();
  });

  it('ledgers an amount mismatch through the durable review RPC', async () => {
    resolveTrusted.mockResolvedValueOnce({
      kind: 'bound',
      merchantId,
      repairId,
    });
    recordMismatch.mockResolvedValueOnce(true);

    const result = await ledgerRepairPickupPaymentClaimMismatch({
      claim: {
        amountKobo: 800_000,
        currency: 'NGN',
        merchantId,
        reference,
        repairId,
      },
      currency: 'NGN',
      gatewayResponse: { currency: 'NGN' },
      reference,
      supabase: {} as never,
      verifiedAmount: 8250,
    });

    expect(result).toEqual({
      handled: true,
      status: 200,
      body: { message: 'Repair pickup payment requires review' },
    });
    expect(recordMismatch).toHaveBeenCalledWith(
      expect.objectContaining({
        mismatchReason: 'amount_mismatch',
        merchantId,
        repairId,
        reference,
        verifiedAmount: 8250,
      })
    );
  });

  it('returns 503 when mismatch persistence fails', async () => {
    resolveTrusted.mockResolvedValueOnce({
      kind: 'bound',
      merchantId,
      repairId,
    });
    recordMismatch.mockResolvedValueOnce(false);

    const result = await ledgerRepairPickupPaymentClaimMismatch({
      claim: null,
      currency: 'NGN',
      gatewayResponse: {},
      reference,
      supabase: {} as never,
      verifiedAmount: 8250,
    });

    expect(result.status).toBe(503);
  });
});
